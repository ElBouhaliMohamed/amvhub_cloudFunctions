const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.

/*
    send notification according to fcm token
    body : {
        actorUUID
        subjectUUID / to get the fcm,
        type: / 0 followed 1 video uploaded etc.
        data: { / data according to the type
            ...
        }
    }
*/

exports = module.exports = functions.https.onRequest(async (req, res) => {
    try {
        let actorUUID = req.body.actorUUID
        let actorDoc = await admin.firestore().doc(`users/${actorUUID}`).get()
        let fcmToken = actorDoc.get('fcm')

        let notificationDoc = await admin.firestore().collection('users').doc(actorUUID).collection('notifications').doc()
        await notificationDoc.set({
            actorUUID: req.body.actorUUID,
            subjectUUID: req.body.subjectUUID,
            type: req.body.type,
            data: req.body.data,
            active: true,
            createdAt: Date.now()
        })

        var message = {
            data: {
                actorUUID: req.body.actorUUID,
                subjectUUID: req.body.subjectUUID,
                type: req.body.type,
                data: JSON.stringify(req.body.data),
                uuid: notificationDoc.id,
                createdAt: JSON.stringify(Date.now())
            },
            token: fcmToken
        }

        console.log(message)
        let response = await admin.messaging().send(message)
        console.log(response)

        res.status(200).send({success: true, response})

    }catch(error) {
        console.log(error)
        res.status(500).send({success: false, error})
    }

});