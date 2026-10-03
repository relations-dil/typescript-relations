// The apps this unum has. Each names its models file and says where its data lives.
//
//   source: 'local'   kept in the browser's localStorage, and in data.js when saved
//   source: 'mock'    in memory only, gone on reload
//
// seed runs once, the first time an app has no stored data at all, so there's something to look at.

const APPS = [
  {
    name: 'example',
    title: 'Example',
    models: 'models/example.js',
    source: 'local',
    seed: async ({ unit, test }) => {
      await new unit([['people'], ['stuff']]).create()
      await new test({ unit_id: 2, name: 'moar' }).create()
    }
  }
]
