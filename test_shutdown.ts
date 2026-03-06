import { HttpClient, HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { Deferred, Duration, Effect, Scope, Option } from "effect"
import * as Exit from "effect/Exit"
import * as http from "node:http"

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
        const fiber = yield* Effect.fork(client.get(`http://127.0.0.1:${port}/delay`).pipe(Effect.flatMap((r) => r.text)))

        // Wait until request reaches server
        yield* Deferred.await(deferred)

        const shutdownFiber = yield* Effect.fork(Scope.close(scope, Exit.void))

        // Give it 100ms to gracefully shut down, then forcefully drop connections
        const shutdownResult = yield* Effect.timeoutTo(shutdownFiber.await, {
          duration: Duration.millis(100),
          onSuccess: Option.some,
          onTimeout: () => Option.none<Exit.Exit<void, never>>()
        })

        if (Option.isNone(shutdownResult)) {
            console.log("Forcing closeAllConnections")
            nodeServer.closeAllConnections()
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

      console.log(res)
}).pipe(Effect.runPromise)
