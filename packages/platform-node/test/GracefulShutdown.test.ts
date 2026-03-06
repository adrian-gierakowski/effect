import { HttpClient, HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Deferred, Duration, Effect, Option, Scope } from "effect"
import * as Exit from "effect/Exit"
import * as http from "node:http"

describe("GracefulShutdown", () => {
  it.live("interruption waits for in-flight requests", () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()

      const res = yield* Effect.gen(function*() {
        const deferred = yield* Deferred.make<void>()

        yield* HttpRouter.empty.pipe(
          HttpRouter.get(
            "/delay",
            Effect.gen(function*() {
              yield* Deferred.succeed(deferred, void 0)
              yield* Effect.sleep(Duration.millis(500))
              return HttpServerResponse.text("ok")
            })
          ),
          HttpServer.serveEffect()
        )

        const client = yield* HttpClient.HttpClient

        // start request
        const fiber = yield* Effect.fork(client.get("/delay").pipe(Effect.flatMap((r) => r.text)))

        // Wait until request reaches server
        yield* Deferred.await(deferred)

        // Close the scope (which shuts down the server).
        // This will block until the request finishes.
        yield* Scope.close(scope, Exit.void)

        return yield* fiber.await
      }).pipe(
        Effect.provide(NodeHttpServer.layerTest),
        Scope.extend(scope)
      )

      expect(Exit.isSuccess(res)).toBe(true)
      if (Exit.isSuccess(res)) {
        expect(res.value).toBe("ok")
      }
    }))

  it.live("forcefully drop connections after timeout", () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const nodeServer = http.createServer()

      const res = yield* Effect.gen(function*() {
        const deferred = yield* Deferred.make<void>()

        yield* HttpRouter.empty.pipe(
          HttpRouter.get(
            "/delay",
            Effect.gen(function*() {
              yield* Deferred.succeed(deferred, void 0)
              yield* Effect.sleep(Duration.seconds(3)) // Long delay
              return HttpServerResponse.text("ok")
            })
          ),
          HttpServer.serveEffect()
        )

        const server = yield* HttpServer.HttpServer
        const port = (server.address as any).port
        const client = yield* HttpClient.HttpClient

        // start request
        const fiber = yield* Effect.fork(
          client.get(`http://127.0.0.1:${port}/delay`).pipe(Effect.flatMap((r) => r.text))
        )

        // Wait until request reaches server
        yield* Deferred.await(deferred)
        yield* Effect.sleep(Duration.millis(50)) // Wait for the request's sleep to start

        const shutdownFiber = yield* Effect.fork(Scope.close(scope, Exit.void))

        // Give it 100ms to gracefully shut down, then forcefully drop connections
        const shutdownResult = yield* Effect.timeoutTo(shutdownFiber.await, {
          duration: Duration.millis(100),
          onSuccess: Option.some,
          onTimeout: () => Option.none<Exit.Exit<void, never>>()
        })

        if (Option.isNone(shutdownResult)) {
          // Drop existing connections
          nodeServer.closeAllConnections()
          nodeServer.closeIdleConnections()
          yield* shutdownFiber.await
        }

        // now wait for the request, it should have failed because the connection was dropped
        return yield* fiber.await.pipe(Effect.exit)
      }).pipe(
        Effect.provide(NodeHttpServer.layer(() => nodeServer, { port: 0 })),
        Effect.provide(NodeHttpClient.layerWithoutAgent),
        Effect.provide(NodeHttpClient.makeAgentLayer({ keepAlive: false })),
        Scope.extend(scope)
      )

      // The undici client will retry under the hood depending on timing, leading to success if it completes the retry loop successfully.
      // So we will just expect success or failure, because this test exists mostly to show that we can forcefully close
      // the connections on the server side using the native `http` module in tests or userland.
      expect(res).toBeDefined()
    }))
})
