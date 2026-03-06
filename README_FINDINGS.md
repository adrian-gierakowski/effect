# Investigation of NodeHttpServer Request Interruption

This report investigates how HTTP request interruption works in `NodeHttpServer` from `@effect/platform-node` and outlines how to implement graceful shutdown with a timeout in userland.

## Tracing the effect execution

When the effect that runs the `NodeHttpServer` is interrupted (or rather, when its `Scope` is closed), it triggers the release action of the `Effect.acquireRelease` block where the server is created.

In `packages/platform-node/src/internal/httpServer.ts`, the implementation looks like this:

```typescript
    const server = yield* Effect.acquireRelease(
      Effect.sync(evaluate),
      (server) =>
        Effect.async<void>((resume) => {
          if (!server.listening) {
            return resume(Effect.void)
          }
          // The callback passed to server.close() will only be called when all
          // in-flight requests and their corresponding sockets are fully closed.
          // This means that when the effect is interrupted (or the scope is closed),
          // it will naturally wait for existing connections to complete.
          server.close((error) => {
            if (error) {
              resume(Effect.die(error))
            } else {
              resume(Effect.void)
            }
          })
        })
    )
```

The underlying action to close the server is simply `server.close()`. According to the Node.js documentation for `http.Server.close()`, this stops the server from accepting new connections, but **it keeps existing connections open**. The callback passed to `server.close()` will only be called when all in-flight requests and their corresponding sockets are fully closed.

### Does the server wait for in-flight requests or interrupt them instantly?

The server **waits for in-flight requests to finish**. It does not interrupt them instantly.

During the shutdown process, the Node.js `server.close()` method allows existing requests to complete normally. Because the `Effect.async` in the release handler waits for the `server.close` callback, the scope closure (and thus the interruption of the surrounding effect) will be suspended until all requests have finished and connections have closed.

If a request takes a very long time, the release of the server scope will hang, waiting for it to finish. There is currently no built-in "force close after timeout" mechanism in the `NodeHttpServer` code itself.

## Generic `@effect/platform` vs runtime specific

The server creation and closure logic is implemented purely in the runtime-specific packages (like `@effect/platform-node`, `@effect/platform-bun`, etc.).

For instance, in `platform-node/src/internal/httpServer.ts`, it explicitly calls Node's `server.close()`. The generic `@effect/platform` defines the interfaces (`HttpServer`, etc.), but the actual lifecycle management (how to start and how to stop the underlying HTTP server) is up to the platform-specific adapters.

## Demonstrating this behavior in tests

I have added tests in `packages/platform-node/test/GracefulShutdown.test.ts` to demonstrate how `Scope.close()` behaves when pending requests are in-flight. I also wrote a test which verifies how to forcibly terminate connections when requests exceed a certain timeout.

## Implementing a graceful shutdown with timeout in userland

As you noted, your goal is to:
1. Wait for in-flight requests to complete
2. But still interrupt requests which don't finish within a certain interval.

To implement this in userland without modifying the Effect packages, you can hook into the shutdown process by using your own `http.Server` instance. However, because `@effect/platform-node` waits indefinitely for `server.close()` during scope closure, you need a way to forcefully close active or hanging sockets if they exceed your timeout.

In Node.js >= 18.2.0, there is a `server.closeAllConnections()` method which forcefully closes all active connections. By passing your own `http.Server` to `NodeHttpServer.layer`, you keep a reference to it and can call `closeAllConnections()` when your timeout hits.

Here is an example of how you can implement this pattern in userland:

```typescript
import { HttpClient, HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { Duration, Effect, Scope } from "effect"
import * as Exit from "effect/Exit"
import * as http from "node:http"

Effect.gen(function*() {
  const scope = yield* Scope.make()
  const nodeServer = http.createServer()

  const app = HttpRouter.empty.pipe(
    HttpRouter.get("/delay", HttpServerResponse.text("ok").pipe(Effect.delay(Duration.seconds(10)))),
    HttpServer.serveEffect()
  )

  const serverLayer = NodeHttpServer.layer(() => nodeServer, { port: 3000 })
  const program = app.pipe(Effect.provide(serverLayer), Scope.extend(scope))

  // Run the program in the background
  yield* Effect.fork(program)

  // ... at some point, shutdown is initiated ...
  yield* Effect.sleep(Duration.seconds(1))

  // Start closing the scope (which calls server.close() inside NodeHttpServer)
  // We fork it because Scope.close will hang waiting for in-flight requests
  const shutdownFiber = yield* Effect.fork(Scope.close(scope, Exit.void))

  // Wait for up to 5 seconds for graceful shutdown
  const shutdownResult = yield* Effect.timeout(shutdownFiber.await, Duration.seconds(5))

  // If it timed out, force close all connections
  if (shutdownResult._tag === "None") {
    console.log("Graceful shutdown timed out. Forcing connections closed...")

    // forcefully aborts all sockets
    nodeServer.closeAllConnections()

    // Now wait for the actual termination (it should be immediate now)
    yield* shutdownFiber.await
  }
}).pipe(Effect.runPromise)
```
