const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.

/*
    data : {
        uid / so access to subcollection is users/uid/feed
    }
    create follows subcollection if not existing yet
    create timeline subcollection if not existing yet
    get follows subcollection and query videos by createdAt and user
    clear timeline and write every new video to it
*/

exports = module.exports = functions.https.onCall(async (data, context) => {
    // get all users we follow
    let followsSnapshot = await admin.firestore().collection('users').doc(data.uid).collection('follows').get()
    console.log('Retrieved users follows')
    // query the videos for each user
    let fetchVideosPromises = []
    for( user of followsSnapshot.docs) {
        let userData = user.data()
        console.log(userData)
        fetchVideosPromises.push(getVideosByUser(userData.uid))
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
    let feedSnapshot = await admin.firestore().collection('users').doc(data.uid).collection('feed').get()
    for ( video of feedSnapshot.docs) {
        video.ref.delete()
    }

    // add the current videos to feed
    console.log('Preparing batch operation to fill new feed')
    console.log(feed)
    let batch = admin.firestore().batch()
    for( video of feed ) {
        let entry = admin.firestore().collection('users').doc(data.uid).collection('feed').doc()
        batch.set(entry, video)
    }
    let result = await batch.commit()
    
    console.log('Finished creating new feed')
    return result;
});

const getVideosByUser = async (uid) => {
    const lastWeek = new Date()
    var pastDate = lastWeek.getDate() - 7
    lastWeek.setDate(pastDate)
    const limitDate = admin.firestore.Timestamp.fromDate(lastWeek)
    console.log(`fetching videos for ${uid}`)
    console.log(`createdAt > ${lastWeek}`)
    console.log(`user == /users/${uid}`)
    var userRef = admin.firestore().collection('users').doc(uid)
    let videosSnapshot = await admin.firestore().collection('videos')
                                    .where("user", "==", userRef)
                                    .where("createdAt", ">", limitDate) // date needs to be bigger or equal than last week
                                    .get()

                                    

    let videos = []
    for( video of videosSnapshot.docs) {
        let videoData = video.data()
        videos.push({
            editor: videoData.editor,
            title: videoData.title,
            uuid: videoData.uuid,
            views: videoData.views,
            user: videoData.user,
            createdAt: videoData.createdAt
        })
    }

    console.log(`Retrieved videos`)
    console.log(videos)
    return videos
}