const http = require("http");

const server = http.createServer((req, res) => {
  console.log("Request received!");
  setTimeout(() => {
    res.writeHead(200);
    res.end("ok");
    console.log("Response sent");
  }, 3000);
});

server.listen(3000, () => {
  console.log("Server listening");

  const req = http.request({
    port: 3000,
    method: "GET"
  }, (res) => {
    console.log("Client got response:", res.statusCode);
  });
  req.on("error", (e) => console.log("Client error:", e.message));
  req.end();

  setTimeout(() => {
    console.log("Force closing sockets...");
    server.closeAllConnections();
  }, 500);
});
