import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import * as HttpServer from '@effect/platform/HttpServer'
import * as HttpServerResponse from '@effect/platform/HttpServerResponse'
import { Duration, Effect } from 'effect'
import * as Http from "node:http"

/**
 * This example demonstrates graceful shutdown with NodeHttpServer.
 *
 * When the server receives a termination signal (SIGINT or SIGTERM):
 * 1. It will immediately start rejecting new incoming requests with a 503 Service Unavailable.
 * 2. It will wait for all in-flight requests to complete before closing the server and exiting the process.
 */

// A simple app that simulates a long-running task
const HttpAppLive = Effect.gen(function*() {
  console.log('Request received, processing for 5 seconds...')
  yield* Effect.sleep(Duration.seconds(5))
  console.log('Request processed!')
  return HttpServerResponse.text('Done!')
})

// Configure and start the server
const ServerLive = NodeHttpServer.layer(() => Http.createServer(), {
  port: 3000,
})

const program = Effect.gen(function*() {
  yield* HttpServer.serveEffect(HttpAppLive)
  console.log("Server is listening on port 3000")
  return yield* Effect.never
}).pipe(
  Effect.scoped,
  Effect.provide(ServerLive),
)

// Run the program using runMain which handles SIGINT/SIGTERM
NodeRuntime.runMain(program)

/**
 * To test graceful shutdown:
 *
 * 1. Run this program:
 *    pnpm exec tsx packages/platform-node/examples/graceful-shutdown.ts
 *
 * 2. In another terminal, make a request:
 *    curl -i http://localhost:3000
 *
 * 3. While the request is pending, press Ctrl+C in the server terminal.
 *
 * 4. Observe that:
 *    - The pending curl request eventually finishes with a 200 OK and "Done!" message.
 *    - If you attempt another curl request after pressing Ctrl+C but before the server exits,
 *      it should receive a 503 Service Unavailable.
 *    - The server process only exits AFTER the pending request has finished.
 */
