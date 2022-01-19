const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {
  admin.initializeApp();
} catch (e) {
  console.log('Admin already initialized');
} // You do that because the admin SDK can only be initialized once.

/*
    send notification according to fcm token
    body : {
        actorUUID
        subjectUUID / to get the fcm,
        type: / VideoUpload/Comment/Follow/News
        data: { / data according to the type
            ...
        }
    }
*/

exports = module.exports = functions.https.onRequest(async (req, res) => {
  try {
    const subjectUUID = req.body.subjectUUID;
    let subjectDoc = await admin.firestore().doc(`users/${subjectUUID}`).get();

    if(!subjectDoc.exists) {
      return res.status(500).send({ success: false, error: 'Subject user does not exist' });
    }

    let notificationDoc = await admin
      .firestore()
      .collection('users')
      .doc(subjectUUID)
      .collection('notifications')
      .doc();

    await notificationDoc.set({
      actorUUID: req.body.actorUUID,
      subjectUUID: req.body.subjectUUID,
      type: req.body.type,
      data: req.body.data,
      active: true,
      createdAt: Date.now(),
    });

    let fcmToken = subjectDoc.get('fcm');
    const notifications = subjectDoc.get('notifications');
    console.log(notifications)

    if(fcmToken == null) {
      return res.status(200).send({ success: true, response: 'Notification saved but none send since fcm is missing' });
    }

    if(notifications == null) {
      return res.status(200).send({ success: true, response: 'Notification saved but none send since permissions are missing' });
    }

    if(req.body.type === 'News' 
      || req.body.type === 'VideoUpload' && notifications.push.videos === true
      || req.body.type === 'Comment' && notifications.push.comments === true
      || req.body.type === 'Follow' && notifications.push.subscribers === true
    ) {
      var message = {
        data: {
          actorUUID: req.body.actorUUID,
          subjectUUID: req.body.subjectUUID,
          type: req.body.type,
          data: JSON.stringify(req.body.data),
          uuid: notificationDoc.id,
          createdAt: JSON.stringify(Date.now()),
        },
        token: fcmToken,
      };

      console.log(message);
      let response = await admin.messaging().send(message);
      console.log(response);

      res.status(200).send({ success: true, response });
    } else {
      res.status(200).send({ success: true, response: 'Notification saved but none send. Permission not granted' });
    }
  } catch (error) {
    console.log(error);
    res.status(500).send({ success: false, error });
  }
});
