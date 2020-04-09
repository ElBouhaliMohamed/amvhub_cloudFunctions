const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.

const { Client } = require('@elastic/elasticsearch')
let elasticSearchConfig = functions.config().elasticsearch;
const client = new Client({
    node: elasticSearchConfig.url,
    auth: {
        username: elasticSearchConfig.username,
        password: elasticSearchConfig.password
    }
})

const transformBody = async (video) => {
    let transformedVideo = {}

    if(video.hasOwnProperty('user')) {
        let userSnapshot = await video.user.get()
        let userData = userSnapshot.data()
        let userName = userData.name
        let userId = video.user.id
        
        transformedVideo.user = {
            name: userName,
            uuid: userId 
        }
    }

    if(video.hasOwnProperty('editors')) {
        let editors = []

        let editorSnapshots = []
        for(editor of video.editors) {
            editorSnapshots.push(editor.get())
        }

        let fetchedEditors = await Promise.all(editorSnapshots)
        for(fetchedEditor of fetchedEditors) {
            let editorData = fetchedEditor.data()
            let editorName = editorData.name
            let editorId = fetchedEditor.id

            editors.push({
                name: editorName,
                uuid: editorId
            })
        }

        transformedVideo.editors = editors
    }

    if(video.hasOwnProperty('teams')) {
        let teams = []

        let teamSnapshots = []
        for(team of video.teams) {
            teamSnapshots.push(team.get())
        }

        let fetchedTeams = await Promise.all(teamSnapshots)
        for(fetchedTeam of fetchedTeams) {
            let teamData = fetchedTeam.data()
            let teamName = teamData.name
            let teamId = fetchedTeam.id

            teams.push({
                name: teamName,
                uuid: teamId
            })
        }

        transformedVideo.teams = teams
    }

    Object.assign(transformedVideo, {
        title: video.title,
        description: video.description,
        createdAt: video.createdAt,
        creationDate: video.creationDate,
        hearts: video.hearts,
        rating: video.rating,
        tags: video.tags,
        songs: video.songs,
        visibility: video.visibility,
        views: video.views
    })

    return transformedVideo;
}

exports = module.exports = functions.firestore.document('/videos/{uuid}').onUpdate( async (change, context) => {
    let videoData = change.after.data()
    let uuid = context.params.uuid;

    console.log(`Transforming data`, videoData)
    const transformedBody = await transformBody(videoData)
    console.log(`Update video ${uuid}: `, transformedBody)

    const result = await client.update({
        id: uuid,
        index: 'videos',
        body: {doc: transformedBody }
    })

    return result;
})