const { register } = require("tsx/cjs/api");

register();

try {
  require("./main.ts");
} catch (error) {
  const moduleNotFound =
    error instanceof Error &&
    "code" in error &&
    error.code === "MODULE_NOT_FOUND";

  if (!moduleNotFound) {
    throw error;
  }

  require("./main");
}
