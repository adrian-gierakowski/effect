
import { HttpServer, HttpServerResponse, NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Duration } from "effect"
import * as Http from "node:http"

// A simple app that simulates a long-running task
const HttpAppLive = Effect.gen(function*() {
  console.log("Request received, processing for 5 seconds...")
  yield* Effect.sleep(Duration.seconds(5))
  console.log("Request processed!")
  return HttpServerResponse.text("Done!")
})

// Configure and start the server
const ServerLive = NodeHttpServer.layer(() => Http.createServer(), { port: 3000 })

const program = HttpServer.serve(HttpAppLive).pipe(
  Effect.provide(ServerLive)
)

// Run the program using runMain which handles SIGINT/SIGTERM
NodeRuntime.runMain(program)

// To test graceful shutdown:
// 1. Run this program: `npx tsx examples/graceful-shutdown.ts`
// 2. In another terminal, make a request: `curl http://localhost:3000`
// 3. While the request is pending, press Ctrl+C in the server terminal
// 4. Observe that the server:
//    - Logs "Request processed!" after 5 seconds
//    - If you try another `curl` during this time, it should get a 503 Service Unavailable
//    - Finally exits
