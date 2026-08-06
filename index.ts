import { startApp } from "./src/server.js";

startApp().catch((error) => {
    console.error("Fatal error starting MCProxy:", error);
    process.exit(1);
});
