import { HttpClient, HttpServerResponse } from "@effect/platform"
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Exit, Fiber, Scope } from "effect"
import * as Http from "node:http"

describe("Graceful Shutdown", () => {
  it("waits for in-flight requests and rejects new ones", () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const server = yield* NodeHttpServer.make(() => Http.createServer(), { port: 0 }).pipe(
        Effect.provideService(Scope.Scope, scope)
      )
      const client = yield* HttpClient.HttpClient.pipe(
        Effect.provide(NodeHttpClient.layerWithoutAgent),
        Effect.provide(NodeHttpClient.makeAgentLayer({ keepAlive: false })),
        Effect.provide(NodeHttpServer.layerContext)
      )
      const address = server.address
      const url = address._tag === "TcpAddress" ? `http://127.0.0.1:${address.port}` : address.path

      const serverFiber = yield* server.serve(
        Effect.gen(function*() {
          yield* Effect.sleep(Duration.millis(500))
          return HttpServerResponse.empty()
        })
      ).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.fork
      )

      yield* Effect.sleep(Duration.millis(100))

      const inFlight = yield* client.get(url).pipe(Effect.fork)
      yield* Effect.sleep(Duration.millis(100))

      // Start shutdown by closing the scope
      const shutdownFiber = yield* Scope.close(scope, Exit.void).pipe(Effect.fork)
      // wait a bit for finalizing to be set but before fiberSet is empty
      yield* Effect.sleep(Duration.millis(200))

      // New request should receive 503
      const response = yield* client.get(url)
      expect(response.status).toBe(503)

      const result = yield* Fiber.join(inFlight)
      expect(result.status).toBe(204)

      yield* Fiber.join(shutdownFiber)
      yield* Fiber.interrupt(serverFiber)
    }).pipe(Effect.runPromise))
})
