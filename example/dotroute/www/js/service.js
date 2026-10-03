// This app: where its data lives, which models it has, and where home is. Everything else is
// relations.js, the same generic layer the other apps use.

// The one line that decides where the data lives. This answers from the models in this page.
// For a relations-restx API instead, it's one line:
//
//   DRApp.rest = DRApp.http;
//
DRApp.rest = DRApp.local({ unit: Unit, test: Test });

seeded.then(async function () {

  DRApp.models = (await DRApp.rest("GET", "api/model"))["models"];

  DRApp.route("home", "/", "Home", "Base", "home");

  DRApp.attach();

  DRApp.start();

  DRApp.refresh();

});
