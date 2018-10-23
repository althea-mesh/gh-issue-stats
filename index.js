const cors = require("cors");
const fetch = require("node-fetch");
const express = require("express");
const base = require("airtable").base(process.env.BASE);
const PORT = process.env.PORT || 5000;
const equal = require("fast-deep-equal");
// get gh cards that are not in airtable
// get gh cards that have changed from airtable

// for card in gh cards
//   find gh card in airtable
//   if exists
//      if changes
//         add to update queue
//   else
//     add to create queue

const postToAirtable = (req, res) => {
  base("Cards").create(
    {
      Name: req.body.Name || "",
      Email: req.body.Email || "",
      Address: req.body.Address || "",
      Message: req.body.Message || "",
      Type: type,
      Newsletter: req.body.Newsletter === "",
      Notify: req.body.Notify === "",
      Honnl3P0t: req.body.Honnl3P0t || "",
      IP: req.ip
    },
    function(err) {
      if (err) {
        console.error(err);
        return;
      }
    }
  );
};

const authHeader =
  "Basic " + Buffer.from(process.env.GH_TOKEN).toString("base64");

const acceptHeader = {
  Accept: "application/vnd.github.inertia-preview+json"
};

const deadlineRegex = /deadline:((\d|\d\d)\/(\d|\d\d)\/\d\d\d\d)/;

let lastReqTime;
let cardCache;

async function fetcher(url, headerOverride, optOverride) {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      ...headerOverride
    },
    ...optOverride
  });

  if (res.status !== 200) {
    throw new Error("http error: " + res.status + ", " + (await res.text()));
  }

  return res.json();
}

function matchOrNull(regex, string) {
  const maybe = regex.exec(string);

  if (maybe) {
    return maybe[1];
  }

  return null;
}

async function getCards() {
  const columns = await fetcher(
    "https://api.github.com/projects/1755122/columns",
    acceptHeader
  );

  const cards = await Promise.all(
    columns.map(async ({ cards_url, name }) => {
      const cards = await fetcher(cards_url, acceptHeader);

      return Promise.all(
        cards.filter(card => !card.archived).map(async card => {
          const issue =
            card.content_url && (await fetcher(card.content_url, acceptHeader));

          let deadline;

          if (card.note) {
            deadline = matchOrNull(deadlineRegex, card.note);
          }
          if (!deadline && issue && issue.title) {
            deadline = matchOrNull(deadlineRegex, issue.title);
          }
          if (!deadline && issue && issue.body) {
            deadline = matchOrNull(deadlineRegex, issue.body);
          }

          const trimmedCard = {
            deadline,
            archived: card.archived,
            note: card.note,
            id: card.id,
            card_created_at: card.created_at,
            issue_created_at: issue && issue.created_at,
            column: name,
            card_url: card.url,
            issue_number: issue && issue.number,
            title: issue && issue.title,
            issue_url: issue && issue.html_url,
            state: issue && issue.state,
            assignees:
              issue &&
              issue.assignees &&
              issue.assignees.map(({ login }) => login),
            body: issue && issue.body
          };

          return trimmedCard;
        })
      );
    })
  );

  const populatedCards = cards.reduce((acc, cardArray) => {
    return cardArray.reduce((acc, card) => {
      acc.push(card);
      return acc;
    }, acc);
  }, []);

  return populatedCards;
}

function createOperationQueues(a, b, idField) {
  const bmap = b.reduce((acc, item) => {
    acc[item[idField]] = item;
    return acc;
  }, {});

  return a.reduce(
    (acc, aItem) => {
      const bItem = bmap[aItem[idField]];

      if (bItem) {
        if (!equal(aItem, bItem)) {
          acc.update.push(aItem);
        }
      } else {
        acc.create.push(aItem);
      }
    },
    { create: [], update: [] }
  );
}

var corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

async function updateAirtable() {
  cards = await getCards();
  lastReqTime = Date.now();
  console.log("got cards from github");

  base("Cards").create(
    {
      Name: req.body.Name || "",
      Email: req.body.Email || "",
      Address: req.body.Address || "",
      Message: req.body.Message || "",
      Type: type,
      Newsletter: req.body.Newsletter === "",
      Notify: req.body.Notify === "",
      Honnl3P0t: req.body.Honnl3P0t || "",
      IP: req.ip
    },
    function(err) {
      if (err) {
        console.error(err);
        return;
      }
    }
  );
}

setInterval(updateCardCache, 1000 * 60);

express()
  .use(cors(corsOptions))
  .get("/cards", async (req, res) => {
    if (Date.now() - lastReqTime < 1000 * 60) {
      cards = cardCache;
      console.log("got cards from cache");
    } else {
      cards = JSON.stringify(await getCards());
      cardCache = cards;
      lastReqTime = Date.now();
      console.log("got cards from github");
    }

    return res.send(cards);
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`));
