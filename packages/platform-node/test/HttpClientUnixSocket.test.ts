import { HttpClient, HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Http from "node:http"
import * as Os from "node:os"
import * as Path from "node:path"

describe("HttpClient Unix Socket", () => {
  it.scoped("communicates over a unix socket", () =>
    Effect.gen(function*() {
      const socketPath = Path.join(Os.tmpdir(), `effect-test-${Date.now()}.sock`)

      const server = yield* NodeHttpServer.make(() => Http.createServer(), {
        path: socketPath
      })

      const router = HttpRouter.empty.pipe(
        HttpRouter.get("/", HttpServerResponse.text("ok"))
      )

      yield* server.serve(router)

      const response = yield* HttpClient.get("/").pipe(
        Effect.flatMap((_) => _.text),
        Effect.provide(HttpServer.layerTestClient.pipe(
          Layer.provide(Layer.succeed(HttpServer.HttpServer, server))
        ))
      )

      expect(response).toEqual("ok")
    }).pipe(
      Effect.provide(NodeHttpClient.layerWithoutAgent.pipe(
        Layer.provide(NodeHttpClient.makeAgentLayer({ keepAlive: false }))
      ))
    ))
})
