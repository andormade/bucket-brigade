require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const AWS = require('aws-sdk');

async function listObjectsPromise(s3, marker) {
	return new Promise((resolve, reject) => {
		s3.listObjects({ Bucket: process.env.SOURCE_BUCKET, MaxKeys: 5, Marker: marker }, async (err, data) => {
			if (err) {
				return reject(err);
			}

			const originals = data['Contents']
				.map(({ Key, LastModified }) => ({
					key: Key,
					lastModified: LastModified,
				}))
				.filter(({ key }) => key.endsWith('.jpg'));

			resolve(originals);
		});
	});
}

async function getOriginals(s3, callback) {
	let last;
	while (true) {
		const originals = await listObjectsPromise(s3, last);

		if (originals.length === 0) {
			break;
		}

		last = originals[originals.length - 1].key;

		for (let i = 0; i < originals.length; i++) {
			await callback(originals[i]);
		}
	}
}

async function downloadOriginal(s3, key) {
	return new Promise((resolve, reject) => {
		s3.getObject({ Bucket: process.env.SOURCE_BUCKET, Key: key }, async (err, data) => {
			if (err) {
				console.log(err);
				return reject(err);
			}

			await fs.mkdir(`.cache/originals/${path.dirname(key)}`, { recursive: true });
			await fs.writeFile(`.cache/originals/${key}`, data.Body);
			resolve();
		});
	});
}

async function uploadOptimized(s3, key, ContentType = 'image/jpg') {
	const content = await fs.readFile('.cache/optimized/' + key);

	return new Promise((resolve, reject) => {
		s3.putObject(
			{
				Bucket: process.env.DESTINATION_BUCKET,
				Key: key,
				Body: content,
				ACL: 'public-read',
				ContentType,
			},
			(err, data) => {
				if (err) {
					console.log(err);
					return reject(err);
				}
				resolve(data);
			}
		);
	});
}

async function optimize(key) {
	await fs.mkdir(`.cache/optimized/${path.dirname(key)}`, { recursive: true });
	return new Promise((resolve, reject) => {
		exec(
			`./magick convert .cache/originals/${key} -resize 1500x1500 -quality 80 .cache/optimized/${key}`,
			(error, stdout, stderr) => {
				if (error) {
					console.log(`${error.message}`);
					return reject();
				}
				if (stderr) {
					console.log(`${stderr}`);
				}
				if (stdout) {
					console.log(`${stdout}`);
				}
				resolve();
			}
		);
	});
}

(async function () {
	const spacesEndpoint = new AWS.Endpoint(process.env.AWS_ENDPOINT);
	const s3 = new AWS.S3({
		endpoint: spacesEndpoint,
		accessKeyId: process.env.ACCESS_KEY,
		secretAccessKey: process.env.SECRET_KEY,
	});

	await getOriginals(s3, async ({ key }) => {
		process.stdout.write('Downloading: ' + key);
		await downloadOriginal(s3, key);
		process.stdout.write(' \x1b[32mdone\n\x1b[0m');
		process.stdout.write('Optimizing: ' + key);
		await optimize(key);
		process.stdout.write(' \x1b[32mdone\n\x1b[0m');
		process.stdout.write('Uploading: ' + key);
		await uploadOptimized(s3, key);
		process.stdout.write(' \x1b[32mdone\n\x1b[0m');
	});
})();
