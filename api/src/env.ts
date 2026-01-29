import dotenv from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Load environment variables from the project root .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: resolve(__dirname, "..", "..", ".env"),
});

