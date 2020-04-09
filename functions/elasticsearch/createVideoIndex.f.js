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

exports = module.exports = functions.firestore.document('/videos/{uuid}').onCreate( async (snap, context) => {
    let videoData = snap.data();
    let uuid = context.params.uuid;

    console.log(`Indexing post ${uuid}: ${JSON.stringify(videoData)}`)

    const result = await client.index({
        id: uuid,
        index: 'videos',
        body: videoData
    })

    return result;
})