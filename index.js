const fetch = require("node-fetch");
const express = require("express");
const PORT = process.env.PORT || 5000;

const authHeader =
  "Basic " + Buffer.from(process.env.GH_TOKEN).toString("base64");

const acceptHeader = {
  Accept: "application/vnd.github.inertia-preview+json"
};

const deadlineRegex = /deadline:((\d|\d\d)\/(\d|\d\d)\/\d\d\d\d)/;

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
    columns.map(async ({ cards_url }) => {
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

          return {
            deadline,
            archived: card.archived,
            note: card.note,
            id: card.id,
            created_at: card.created_at,
            column: /\/(\d+)$/.exec(card.column_url)[1],
            html_url: card.url,
            issue: issue && {
              number: issue.number,
              title: issue.title,
              html_url: issue.html_url,
              state: issue.state,
              assignees:
                issue.assignees && issue.assignees.map(({ login }) => login),
              created_at: issue.created_at,
              body: issue.body
            }
          };
        })
      );
    })
  );

  const populatedColumns = columns.map((column, i) => {
    column.cards = cards[i];
    return column;
  });

  return populatedColumns;
}

// { url: 'https://api.github.com/projects/columns/cards/13206218',
//     project_url: 'https://api.github.com/projects/1755122',
//     id: 13206218,
//     node_id: 'MDExOlByb2plY3RDYXJkMTMyMDYyMTg=',
//     note: null,
//     archived: false,
//     creator:
//      { login: 'jtremback',
//        id: 1335122,
//        node_id: 'MDQ6VXNlcjEzMzUxMjI=',
//        avatar_url: 'https://avatars2.githubusercontent.com/u/1335122?v=4',
//        gravatar_id: '',
//        url: 'https://api.github.com/users/jtremback',
//        html_url: 'https://github.com/jtremback',
//        followers_url: 'https://api.github.com/users/jtremback/followers',
//        following_url:
//         'https://api.github.com/users/jtremback/following{/other_user}',
//        gists_url: 'https://api.github.com/users/jtremback/gists{/gist_id}',
//        starred_url:
//         'https://api.github.com/users/jtremback/starred{/owner}{/repo}',
//        subscriptions_url: 'https://api.github.com/users/jtremback/subscriptions',
//        organizations_url: 'https://api.github.com/users/jtremback/orgs',
//        repos_url: 'https://api.github.com/users/jtremback/repos',
//        events_url: 'https://api.github.com/users/jtremback/events{/privacy}',
//        received_events_url: 'https://api.github.com/users/jtremback/received_events',
//        type: 'User',
//        site_admin: false },
//     created_at: '2018-09-21T17:38:15Z',
//     updated_at: '2018-09-21T17:39:11Z',
//     column_url: 'https://api.github.com/projects/columns/3361104',
//     content_url:
//      'https://api.github.com/repos/althea-mesh/althea_rs/issues/278' },

express()
  .get("/cards", async (req, res) => res.send(JSON.stringify(await getCards())))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));
