export const up = (pgm) => {
  pgm.addColumns("mailarchive_rules", {
    last_run_at: { type: "timestamptz" },
    max_per_run: { type: "integer", notNull: true, default: 50 },
  });
};

export const down = (pgm) => {
  pgm.dropColumns("mailarchive_rules", ["last_run_at", "max_per_run"]);
};
