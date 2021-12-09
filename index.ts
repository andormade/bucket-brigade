import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import AWS from 'aws-sdk';
import rmrf from 'rmrf';

config();

function isToday(date: Date): boolean {
	const today = new Date();
	return (
		date.getDate() == today.getDate() &&
		date.getMonth() == today.getMonth() &&
		date.getFullYear() == today.getFullYear()
	);
}

async function listObjectsPromise(
	s3: AWS.S3,
	marker?: string | undefined
): Promise<Array<{ key: string; lastModified: Date }>> {
	return new Promise((resolve, reject) => {
		s3.listObjects(
			{ Bucket: process.env.SOURCE_BUCKET || '', MaxKeys: 5, Marker: marker },
			async (err, { Contents = [] }) => {
				if (err) {
					return reject(err);
				}

				const objects = Contents.map(({ Key = '', LastModified = new Date() }) => ({
					key: Key,
					lastModified: LastModified,
				}));

				resolve(objects);
			}
		);
	});
}

async function getOriginals(
	s3: AWS.S3,
	callback: (objects: { key: string; lastModified: Date }) => Promise<void>
): Promise<void> {
	let lastKey: string | undefined = undefined;
	while (true) {
		await rmrf('.cache');

		const objects: Array<{ lastModified: Date; key: string }> = await listObjectsPromise(s3, lastKey);

		if (objects.length === 0) {
			break;
		}

		lastKey = objects[objects.length - 1].key;

		const originals = objects
			.filter(({ lastModified }) => isToday(new Date(lastModified)))
			.filter(({ key }) => key.endsWith('.jpg'));

		for (let i = 0; i < originals.length; i++) {
			await callback(originals[i]);
		}
	}
}

async function downloadOriginal(s3: AWS.S3, key: string): Promise<void> {
	return new Promise((resolve, reject) => {
		s3.getObject({ Bucket: process.env.SOURCE_BUCKET || '', Key: key }, async (err, data) => {
			if (err) {
				console.log(err);
				return reject(err);
			}

			await fs.mkdir(`.cache/originals/${path.dirname(key)}`, { recursive: true });
			await fs.writeFile(`.cache/originals/${key}`, data.Body as string);
			resolve();
		});
	});
}

async function uploadOptimized(s3: AWS.S3, key: string, ContentType = 'image/jpg'): Promise<AWS.S3.PutObjectOutput> {
	const content = await fs.readFile('.cache/optimized/' + key);

	return new Promise((resolve, reject) => {
		s3.putObject(
			{
				Bucket: process.env.DESTINATION_BUCKET || '',
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

async function optimize(key: string): Promise<void> {
	await fs.mkdir(`.cache/optimized/${path.dirname(key)}`, { recursive: true });
	return new Promise((resolve, reject) => {
		exec(
			`./magick convert '.cache/originals/${key}' -resize 1500x1500 '.cache/optimized/${key}'`,
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
	const spacesEndpoint = new AWS.Endpoint(process.env.AWS_ENDPOINT || '');
	const s3 = new AWS.S3({
		endpoint: spacesEndpoint,
		accessKeyId: process.env.ACCESS_KEY || '',
		secretAccessKey: process.env.SECRET_KEY || '',
	});

	await getOriginals(s3, async ({ key }) => {
		process.stdout.write('\x1b[2m' + key + '\x1b[0m');
		process.stdout.write(' downloading...');
		await downloadOriginal(s3, key);
		process.stdout.write(' \x1b[32mdone\x1b[0m');
		process.stdout.write(' optimizing...');
		await optimize(key);
		process.stdout.write(' \x1b[32mdone\x1b[0m');
		process.stdout.write(' uploading...');
		await uploadOptimized(s3, key);
		process.stdout.write(' \x1b[32mdone\n\x1b[0m');
	});
})();
