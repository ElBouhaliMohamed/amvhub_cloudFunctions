const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.
const axios = require('axios')

/*
    request features from strapi
    query videos by uuid
    clear featured collection and write every new video to it
*/

exports = module.exports = functions.https.onRequest(async (req, res) => {
    // request features from strapi
    let allFeaturesFromStrapi = await getAllFeaturesFromStrapi();

    // query videos by uuid
    let fetchFeaturesPromises = []
    for ( feature of allFeaturesFromStrapi.data ) {
      fetchFeaturesPromises.push(fetchVideo(feature.UUID, feature.Ranking))
    }
    let allFeatures = await Promise.all(fetchFeaturesPromises)

    // clear the current features in firestore
    console.log('Clear current features')
    let featuredSnapshot = await admin.firestore().collection('featured').get()
    for ( video of featuredSnapshot.docs) {
        video.ref.delete()
    }

    // add the current videos to feed
    console.log('Preparing batch operation to fill new feed')
    console.log(allFeatures)
    let batch = admin.firestore().batch()
    for( video of allFeatures ) {
        let entry = admin.firestore().collection('featured').doc(video.uuid)
        batch.set(entry, video)
    }
    let result = await batch.commit()
    
    console.log('Finished creating new features')
    res.status(200).send(result);
});

const fetchVideo = async (uuid, ranking) => {
    let videoSnapshot = await admin.firestore().collection('videos').doc(uuid).get()
    let videoData = videoSnapshot.data()
    return {
        editors: videoData.editors,
        title: videoData.title,
        uuid: videoData.uuid,
        views: videoData.views,
        user: videoData.user,
        createdAt: videoData.createdAt,
        hasPoster: videoData.hasPoster,
        ranking
    }
}

const getAllFeaturesFromStrapi = async () => {
  try {
    const response = await axios.get('http://45.76.82.111:1337/featureds')
    console.log(response.data)
    return response
  } catch (error) {
    console.error(error)
    throw error
  }
}