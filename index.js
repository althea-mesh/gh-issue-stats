const { DateTime } = require("luxon");
const fetch = require("node-fetch");
const Airtable = require("airtable");
const base = new Airtable({ apiKey: process.env.AIRTABLE_KEY }).base(
  process.env.BASE
);
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

const authHeader =
  "Basic " + Buffer.from(process.env.GH_TOKEN).toString("base64");

const acceptHeader = {
  Accept: "application/vnd.github.inertia-preview+json"
};

const deadlineRegex = /deadline:((\d|\d\d)\/(\d|\d\d)\/\d\d\d\d)/;

const airtableTimeout = 400;
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

async function getAirtableRecords() {
  const airtableRecords = [];

  await base(process.env.TABLE)
    .select()
    .eachPage(function page(records, fetchNextPage) {
      records.forEach(record => {
        const rec = record._rawJson.fields;
        rec.airtable_id = record._rawJson.id;
        airtableRecords.push(rec);
      });

      fetchNextPage();
    });

  console.log("got Airtable cards", airtableRecords.length);
  return airtableRecords;
}

async function getGithubCards() {
  const columns = await fetcher(
    "https://api.github.com/projects/" + process.env.GH_PROJECT + "/columns",
    acceptHeader
  );

  const cards = await Promise.all(
    columns.map(async ({ cards_url, name }) => {
      const cards = await fetcher(cards_url, acceptHeader);

      return Promise.all(
        cards
          .filter(card => !card.archived && card.content_url)
          .map(async card => {
            const issue = await fetcher(card.content_url, acceptHeader);

            const deadline =
              matchOrNull(deadlineRegex, issue.title) ||
              matchOrNull(deadlineRegex, issue.body);

            const trimmedCard = {
              title: issue.title,
              deadline:
                deadline &&
                DateTime.fromFormat(deadline, "M/d/yyyy").toISODate(),
              body: issue.body,
              state: issue.state,
              column: name,
              assignees:
                issue.assignees &&
                issue.assignees.reduce((acc, { login }) => {
                  acc = acc + " " + login;
                  return acc;
                }, ""),
              issue_created_at: DateTime.fromISO(issue.created_at).toISODate(),
              repo_name: matchOrNull(/([^/]*?)$/, issue.repository_url),
              issue_number: issue.number,
              issue_url: issue.html_url,
              id: card.id
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

  console.log("got GH cards", populatedCards.length);
  return populatedCards;
}

function filterNullAndEmpty(obj) {
  Object.keys(obj).forEach(key => {
    if (obj[key] === "" || obj[key] === null) {
      delete obj[key];
    }
  });
}
function createOperationQueues(a, b, idField) {
  const bmap = b.reduce((acc, item) => {
    acc[item[idField]] = item;
    return acc;
  }, {});

  return a.reduce(
    (acc, aItem) => {
      const bItem = bmap[aItem[idField]];
      // console.log("BITT", aItem, idField, aItem[idField], bItem);

      if (bItem) {
        // this stuff makes it so that equality checks work right since airtable won't
        // return fields that are null or empty strings
        aItem.airtable_id = bItem.airtable_id;
        filterNullAndEmpty(aItem);
        if (!equal(aItem, bItem)) {
          acc.update.push(aItem);
        }
      } else {
        acc.create.push(aItem);
      }
      return acc;
    },
    { create: [], update: [] }
  );
}

// 10
// req
// 12
// reqDuration = 12 - 10 = 2
// wait timeout - reqDuration

function sleep(duration) {
  return new Promise(resolve => {
    setTimeout(resolve, duration);
  });
}

async function airtableCreate(card) {
  const start = Date.now();
  try {
    await base(process.env.TABLE).create(card);
  } catch (e) {
    console.error(e);
  }
  console.log("card created", card.note || card.title);
  await sleep(airtableTimeout - (Date.now() - start));
}

async function airtableUpdate(card) {
  const start = Date.now();

  try {
    await base(process.env.TABLE).update(card.airtable_id, card);
  } catch (e) {
    console.error(e);
  }
  console.log("card updated", card.note || card.title);
  await sleep(airtableTimeout - (Date.now() - start));
}

async function doIt() {
  const [ghCards, airtableRecords] = await Promise.all([
    getGithubCards(),
    getAirtableRecords()
  ]);

  const opQs = createOperationQueues(ghCards, airtableRecords, "id");

  console.log(
    "created operation queues, create: " +
      opQs.create.length +
      ", update: " +
      opQs.update.length
  );

  for (const card of opQs.create) {
    await airtableCreate(card);
  }

  for (const card of opQs.update) {
    await airtableUpdate(card);
  }
}

doIt();
setInterval(doIt, 60 * 1000);
