const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.

/*
    data : {
        uuid / so access to subcollection is users/uuid/feed
    }
    create follows subcollection if not existing yet
    create timeline subcollection if not existing yet
    get follows subcollection and query videos by createdAt and user
    clear timeline and write every new video to it
*/

exports = module.exports = functions.https.onCall(async (data, context) => {
    // get all users we follow
    console.log(data)
    let followsSnapshot = await admin.firestore().collection('users').doc(data.uuid).collection('follows').get()
    console.log('Retrieved users follows')
    // query the videos for each user
    let fetchVideosPromises = []
    for( user of followsSnapshot.docs) {
        let userData = user.data()
        console.log(userData)
        fetchVideosPromises.push(getVideosByUser(userData.uuid))
    }
    let fetchedVideos = await Promise.all(fetchVideosPromises)

    // add the fetched videos as seperate objects to our feed array
    console.log('Concating the feed')
    let feed = []
    for( videosByUser of fetchedVideos ) {
        feed = feed.concat(videosByUser)
    }

    // clear the current feed in firestore
    console.log('Clear current feed')
    let feedSnapshot = await admin.firestore().collection('users').doc(data.uuid).collection('feed').get()
    for ( video of feedSnapshot.docs) {
        video.ref.delete()
    }

    // add the current videos to feed
    console.log('Preparing batch operation to fill new feed')
    console.log(feed)
    let batch = admin.firestore().batch()
    for( video of feed ) {
        let entry = admin.firestore().collection('users').doc(data.uuid).collection('feed').doc()
        batch.set(entry, video)
    }
    let result = await batch.commit()
    
    console.log('Finished creating new feed')
    return result;
});

const getVideosByUser = async (uuid) => {
    const lastMonth = new Date()
    var pastDate = lastMonth.getDate() - 31
    lastMonth.setDate(pastDate)
    const limitDate = admin.firestore.Timestamp.fromDate(lastMonth)
    console.log(`fetching videos for ${uuid}`)
    console.log(`createdAt > ${lastMonth}`)
    console.log(`user == /users/${uuid}`)
    var userRef = admin.firestore().collection('users').doc(uuid)

    let videosSnapshot = await admin.firestore().collection('videos')
    .where("user", "==", userRef)
    .where("createdAt", ">=", limitDate) // date needs to be bigger or equal than last month
    .get()

    let videos = []
    for( video of videosSnapshot.docs) {
        let videoData = video.data()
        videos.push({
            editors: videoData.editors,
            title: videoData.title,
            uuid: videoData.uuid,
            views: videoData.views,
            user: videoData.user,
            description: videoData.description,
            createdAt: videoData.createdAt,
        })
    }

    console.log(`Retrieved videos`)
    console.log(videos)
    return videos
}