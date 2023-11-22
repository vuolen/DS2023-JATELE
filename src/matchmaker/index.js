// express hello world
const express = require("express");
const cors = require("cors");

const app = express();
const port = 3000;

const clients = [];

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => res.json({ clients }));

app.post("/active", (req, res) => {
  clients.push(req.body.id);
  res.status(200);
  res.end();
});

app.listen(port, () =>
  console.log(`Example app listening at http://localhost:${port}`)
);
