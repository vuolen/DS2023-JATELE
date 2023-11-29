// express hello world
const express = require("express");
const cors = require("cors");
const { ExpressPeerServer} = require("peer");

const app = express();
const port = 3000;

const clients = [];

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

app.get("/", (req, res) => res.json({ clients }));

app.post("/active", (req, res) => {
  clients.push(req.body.id);
  res.status(200);
  res.end();
});
