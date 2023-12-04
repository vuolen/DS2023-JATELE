// express hello world
const express = require("express");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");

const app = express();
const port = 3000;

let clients = {};

setInterval(() => {
  const len = Object.keys(clients).length;
  clients = Object.fromEntries(
    Object.entries(clients).filter(
      ([_, timestamp]) => new Date().getTime() - timestamp < 20000
    )
  );
  console.log(`Cleared ${len - Object.keys(clients).length} clients`);
}, 10000);

server = app.listen(port, () =>
  console.log(`Example app listening at http://localhost:${port}`)
);

const peerServer = ExpressPeerServer(server, {
  path: "/",
  debug: true,
});

app.use("/peer", peerServer);
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => res.json({ clients: Object.keys(clients) }));

app.post("/active", (req, res) => {
  clients[req.body.id] = new Date().getTime();
  res.status(200);
  res.end();
});
