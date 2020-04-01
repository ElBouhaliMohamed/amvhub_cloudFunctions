const functions = require('firebase-functions');
const admin = require('firebase-admin');
try {admin.initializeApp();} catch(e) { console.log('Admin already initialized')} // You do that because the admin SDK can only be initialized once.
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpeg_static = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpeg_static)

// Max height and width of the thumbnail in pixels.
const THUMB_MAX_HEIGHT = 720;
const THUMB_MAX_WIDTH = 1280;

// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';
const PREVIEW_PREFIX = 'preview_';


const runtimeOpts = {
    timeoutSeconds: 300,
    memory: '1GB'
}

exports = module.exports = functions.runWith(runtimeOpts).storage.object().onFinalize(async (object) => {
  console.log(process.env.FIREBASE_CONFIG);
  console.log('object', JSON.stringify(object));

  // File and directory paths.
  const filePath = object.name;
  const contentType = object.contentType; // This is the image MIME type
  const fileName = path.parse(filePath).name;
  const tempLocalFile = path.join(os.tmpdir(), path.basename(filePath).replace(/ /g, "_"));

  // Exit if this is triggered on a file that is not an image.
  if (!contentType.startsWith('video/')) {
    return console.log('This is not a video.');
  }

  if(fileName.startsWith(PREVIEW_PREFIX)) {
    return console.log('This is a preview so no thumbnail needed.')
}


  // Add thumbnail to database
  await admin.firestore().collection('thumbnails').doc(fileName).set({
    setProcessed: false
  });

  // Cloud Storage files.
  const bucket = admin.storage().bucket(object.bucket);
  const file = bucket.file(filePath);
  const metadata = {
    contentType: 'image/png',
    // To enable Client-side caching you can set the Cache-Control headers here. Uncomment below.
    'Cache-Control': 'public,max-age=3600'

  };
  
  // Download file from bucket.
  console.log('Downloading File')
  await file.download({destination: tempLocalFile});
  console.log('The file has been downloaded to', tempLocalFile);

  const tempLocalThumbFolder = os.tmpdir();
  const tempLocalThumb1File = path.join(tempLocalThumbFolder,`${THUMB_PREFIX}${fileName.replace(/ /g, "_")}_1.png`);
  const tempLocalThumb2File = path.join(tempLocalThumbFolder,`${THUMB_PREFIX}${fileName.replace(/ /g, "_")}_2.png`);
  const tempLocalThumb3File = path.join(tempLocalThumbFolder,`${THUMB_PREFIX}${fileName.replace(/ /g, "_")}_3.png`);

  console.log(`Path to ffmpeg ${ffmpeg_static}`)
  await new Promise((resolve, reject) => {
    ffmpeg(tempLocalFile)
      .on('filenames', (filenames) => {
        console.log('Will generate ' + filenames.join(', '))
      })
      .on('end', resolve)
      .on('error', reject)
      .takeScreenshots({count: 3, folder: tempLocalThumbFolder, filename: `${THUMB_PREFIX}%b`, size: `${THUMB_MAX_WIDTH}x${THUMB_MAX_HEIGHT}`})
  });

  const thumbsFolder = path.normalize(path.join('thumbnails', fileName));
  const thumb1FilePath = path.normalize(path.join('thumbnails', path.join(fileName, `${THUMB_PREFIX}${fileName.replace(/ /g, "_")}_1.png`)));
  const thumb2FilePath = path.normalize(path.join('thumbnails', path.join(fileName, `${THUMB_PREFIX}${fileName.replace(/ /g, "_")}_2.png`)));
  const thumb3FilePath = path.normalize(path.join('thumbnails', path.join(fileName, `${THUMB_PREFIX}${fileName.replace(/ /g, "_")}_3.png`)));

  const thumbFile1 = bucket.file(thumb1FilePath);
  const thumbFile2 = bucket.file(thumb2FilePath);
  const thumbFile3 = bucket.file(thumb3FilePath);

  fs.readdirSync(tempLocalThumbFolder).forEach(file => {
    console.log(file);
  });
  
  console.log('Thumbnails created at ' + tempLocalThumbFolder + ' and will be uploaded to ' + thumbsFolder);

  // Uploading the Thumbnail.
  await bucket.upload(tempLocalThumb1File, {destination: thumb1FilePath, resumable: false, metadata: metadata});
  await bucket.upload(tempLocalThumb2File, {destination: thumb2FilePath, resumable: false, metadata: metadata});
  await bucket.upload(tempLocalThumb3File, {destination: thumb3FilePath, resumable: false, metadata: metadata});
  console.log('Thumbnails uploaded to Storage at', thumbsFolder);
  // Once the image has been uploaded delete the local files to free up disk space.
  fs.unlinkSync(tempLocalFile);
  fs.unlinkSync(tempLocalThumb1File);
  fs.unlinkSync(tempLocalThumb2File);
  fs.unlinkSync(tempLocalThumb3File);

  // Get the Signed URLs for the thumbnail and original image.
  const config = {
    action: 'read',
    expires: '03-17-2025'
  };
  const results = await Promise.all([
    thumbFile1.getSignedUrl(config),
    thumbFile2.getSignedUrl(config),
    thumbFile3.getSignedUrl(config),
    file.getSignedUrl(config),
  ]);

  console.log('Got Signed URLs.');
  const thumbResult1 = results[0];
  const thumbResult2 = results[1];
  const thumbResult3 = results[2];

  const thumbFileUrl1 = thumbResult1[0];
  const thumbFileUrl2 = thumbResult2[0];
  const thumbFileUrl3 = thumbResult3[0];

  const originalResult = results[3];
  const fileUrl = originalResult[0];

  // Add the URLs to the Database
  await admin.firestore().collection('thumbnails').doc(fileName).set({
      isProcessed: true,
      thumbnails: [thumbFileUrl1, thumbFileUrl2, thumbFileUrl3],
      active: 1
  })

  return console.log('Thumbnail URLs saved to database.');
});