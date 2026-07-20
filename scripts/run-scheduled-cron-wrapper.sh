#!/usr/bin/env bash
# Wrapper for scheduled archive: run this from your HOME or /usr/local so cron can
# execute it (macOS blocks cron from running scripts on external volumes like HubSSD).
#
# Setup:
#   1. Copy this file to your main disk, e.g.:
#        mkdir -p ~/bin
#        cp /Volumes/HubSSD/www/mailarchive/scripts/run-scheduled-cron-wrapper.sh ~/bin/mailarchive-run-scheduled.sh
#        chmod +x ~/bin/mailarchive-run-scheduled.sh
#   2. Create ~/.mailarchive-cron.env with:
#        CRON_SECRET=your-secret-here
#      Optional:
#        MAILARCHIVE_API_URL=http://localhost:3000
#        NTFY_TOPIC=your-private-topic   # enables push alerts (failure + success)
#        NTFY_URL=https://ntfy.sh        # or your self-hosted server
#        NTFY_TOKEN=                     # if the topic requires auth
#        NTFY_ON_SUCCESS=1               # set to 0 to skip success pushes (failures still notify)
#   3. Update crontab to call the wrapper:
#        0 3 * * * $HOME/bin/mailarchive-run-scheduled.sh >> /tmp/mailarchive-cron.log 2>&1
#   4. Subscribe to NTFY_TOPIC in the ntfy app (phone/desktop).

set -u

CONFIG="$HOME/.mailarchive-cron.env"
TMP=
trap '[[ -n "${TMP:-}" && -f "${TMP:-}" ]] && rm -f "$TMP"' EXIT

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# Best-effort ntfy push. No-op if NTFY_TOPIC is unset. Never fails the job.
ntfy_send() {
  local title="$1"
  local message="$2"
  local priority="${3:-3}"
  local tags="${4:-}"

  if [[ -z "${NTFY_TOPIC:-}" ]]; then
    return 0
  fi

  local base="${NTFY_URL:-https://ntfy.sh}"
  local url="${base%/}/${NTFY_TOPIC}"
  local -a args=(-sS --connect-timeout 5 -m 15
    -H "Title: ${title}"
    -H "Priority: ${priority}"
  )
  if [[ -n "$tags" ]]; then
    args+=(-H "Tags: ${tags}")
  fi
  if [[ -n "${NTFY_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${NTFY_TOKEN}")
  fi

  curl "${args[@]}" -d "$message" "$url" >/dev/null 2>&1 || \
    echo "$(ts) WARN: ntfy send failed (non-fatal)" >&2
}

fail() {
  local msg="$1"
  echo "$(ts) ERROR: $msg" >&2
  ntfy_send "Mail Archive failed" "$msg" 5 "warning,email"
  exit 1
}

if [[ ! -f "$CONFIG" ]]; then
  # Can't source NTFY_TOPIC yet — still try env if cron exported it
  fail "$CONFIG not found"
fi
# shellcheck source=/dev/null
source "$CONFIG"

if [[ -z "${CRON_SECRET:-}" ]]; then
  fail "CRON_SECRET not set in $CONFIG"
fi

API_URL="${MAILARCHIVE_API_URL:-http://localhost:3000}"
echo "$(ts) Calling $API_URL/api/jobs/run-scheduled"

TMP=$(mktemp)
http_code="000"
curl_rc=0
# Scheduled archive can take a long time (rules may use max_per_run up to 500,
# with MIME download + Drive/OneDrive upload per message). Keep curl's limit
# well above that so cron does not report a false HTTP 000 timeout while the
# API is still working.
CURL_MAX_TIME="${MAILARCHIVE_CRON_TIMEOUT_SEC:-3600}"
set +e
http_code=$(curl -sS --connect-timeout 10 -m "$CURL_MAX_TIME" -X POST "${API_URL}/api/jobs/run-scheduled" \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o "$TMP" \
  -w "%{http_code}")
curl_rc=$?
set -e

body=$(cat "$TMP" 2>/dev/null || true)
echo "$(ts) HTTP ${http_code}"
if [[ -n "$body" ]]; then
  echo "$body"
fi

if [[ $curl_rc -ne 0 ]]; then
  fail "curl failed (rc=${curl_rc}) — API unreachable at ${API_URL}?"
fi

if [[ "$http_code" != "200" ]]; then
  snippet=$(printf '%s' "$body" | head -c 240)
  fail "HTTP ${http_code} from run-scheduled${snippet:+: $snippet}"
fi

# API returns 200 even when individual rules error — surface those too.
# Prints: summary_line, optional error_detail, optional success_message
parse_out=$(printf '%s' "$body" | /usr/bin/python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    print("INVALID_JSON")
    sys.exit(2)

summaries = data.get("summaries") or []
ran = sum(1 for s in summaries if s.get("ran"))
archived = data.get("totalArchived")
if archived is None:
    archived = sum(int(s.get("totalArchived") or 0) for s in summaries)
failed = data.get("totalFailed")
if failed is None:
    failed = sum(int(s.get("totalFailed") or 0) for s in summaries)

errors = []
for s in summaries:
    err = s.get("error")
    if err:
        rid = s.get("ruleId") or "?"
        errors.append("%s: %s" % (rid, err))

print("ran=%d total=%d archived=%d failed=%d errors=%d" % (
    ran, len(summaries), archived, failed, len(errors)))
if errors:
    print("; ".join(errors[:5]))
    sys.exit(1)

# success message for ntfy (line 2)
noun = "email" if archived == 1 else "emails"
extra = ""
if failed:
    extra = " (%d failed)" % failed
print("Archived %d %s across %d rule(s)%s." % (archived, noun, ran, extra))
sys.exit(0)
' 2>/dev/null)
parse_rc=$?

if [[ $parse_rc -eq 2 ]]; then
  fail "run-scheduled returned non-JSON body: $(printf '%s' "$body" | head -c 240)"
fi

summary_line=$(printf '%s\n' "$parse_out" | head -n 1)
second_line=$(printf '%s\n' "$parse_out" | sed -n '2p')
echo "$(ts) $summary_line"

if [[ $parse_rc -ne 0 ]]; then
  fail "Scheduled rule errors — ${summary_line}${second_line:+; $second_line}"
fi

# Success notify on by default when NTFY_TOPIC is set; set NTFY_ON_SUCCESS=0 to skip.
if [[ "${NTFY_ON_SUCCESS:-1}" != "0" ]]; then
  success_msg="${second_line:-$summary_line}"
  echo "$(ts) $success_msg"
  ntfy_send "Mail Archive OK" "$success_msg" 3 "white_check_mark,email"
fi

exit 0
