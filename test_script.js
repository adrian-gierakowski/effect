const http = require("http");

const server = http.createServer((req, res) => {
  console.log("Request received!");
  setTimeout(() => {
    res.writeHead(200);
    res.end("ok");
    console.log("Response sent");
  }, 2000);
});

server.listen(3000, () => {
  console.log("Server listening");

  const req = http.request({
    port: 3000,
    method: "GET"
  }, (res) => {
    console.log("Client got response:", res.statusCode);
  });
  req.end();

  setTimeout(() => {
    console.log("Closing server...");
    server.close(() => {
      console.log("Server closed");
    });
  }, 500);
});
