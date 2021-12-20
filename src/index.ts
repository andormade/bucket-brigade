#!/usr/bin/env node

import oldFs, { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import AWS from 'aws-sdk';
import rmrf from 'rmrf';
import rc from 'rc';

const config = rc('bucket-brigade', {
	awsEndpoint: '',
	accessKey: '',
	secretKey: '',
	sourceBucket: '',
	destinationBucket: '',
	cacheDir: '.bucket-brigade-cache',
	transformCommandTemplate: 'cp {source} {destination}',
});

async function listObjectsPromise(
	s3: AWS.S3,
	marker?: string | undefined
): Promise<Array<{ key: string; lastModified: Date }>> {
	return new Promise((resolve, reject) => {
		s3.listObjects({ Bucket: config.sourceBucket, MaxKeys: 5, Marker: marker }, async (err, { Contents = [] }) => {
			if (err) {
				return reject(err);
			}

			const objects = Contents.map(({ Key = '', LastModified = new Date() }) => ({
				key: Key,
				lastModified: LastModified,
			}));

			resolve(objects);
		});
	});
}

async function getOriginals(
	s3: AWS.S3,
	lastRan: Date,
	callback: (objects: { key: string; lastModified: Date }) => Promise<void>
): Promise<void> {
	let lastKey: string | undefined = undefined;
	while (true) {
		await rmrf(config.cacheDir);

		const objects: Array<{ lastModified: Date; key: string }> = await listObjectsPromise(s3, lastKey);

		if (objects.length === 0) {
			break;
		}

		lastKey = objects[objects.length - 1].key;

		const originals = objects
			.filter(({ lastModified }) => {
				return lastModified.getTime() >= lastRan.getTime();
			})
			.filter(({ key }) => key.endsWith('.jpg'));

		for (let i = 0; i < originals.length; i++) {
			await callback(originals[i]);
		}
	}
}

async function downloadOriginal(s3: AWS.S3, key: string): Promise<void> {
	return new Promise((resolve, reject) => {
		s3.getObject({ Bucket: config.sourceBucket, Key: key }, async (err, data) => {
			if (err) {
				console.log(err);
				return reject(err);
			}

			await fs.mkdir(`${config.cacheDir}/originals/${path.dirname(key)}`, { recursive: true });
			await fs.writeFile(`${config.cacheDir}/originals/${key}`, data.Body as string);
			resolve();
		});
	});
}

async function uploadTransformed(s3: AWS.S3, key: string, ContentType = 'image/jpg'): Promise<AWS.S3.PutObjectOutput> {
	const content = await fs.readFile(`${config.cacheDir}/transformed/` + key);

	return new Promise((resolve, reject) => {
		s3.putObject(
			{
				Bucket: config.destinationBucket,
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

async function transform(key: string): Promise<void> {
	await fs.mkdir(`.cache/transformed/${path.dirname(key)}`, { recursive: true });
	return new Promise((resolve, reject) => {
		exec(
			config.transformCommandTemplate
				.replace('{source}', `${config.cacheDir}/originals/${key}`)
				.replace('{dest}', `${config.cacheDir}/transformed/${key}`),
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

async function getLastRunTime(): Promise<Date> {
	if (!oldFs.existsSync('./.last-run')) {
		return new Date(0);
	}
	const file = await fs.readFile('./.last-run');
	const lastRun = parseInt(file.toString(), 10);
	return new Date(lastRun);
}

async function writeLastRunTime(): Promise<void> {
	await fs.writeFile('./.last-run', new Date().getTime().toString());
}

(async function () {
	const lastRan = await getLastRunTime();
	await writeLastRunTime();

	console.log('Collecting files...');

	const spacesEndpoint = new AWS.Endpoint(config.awsEndpoint);
	const s3 = new AWS.S3({
		endpoint: spacesEndpoint,
		accessKeyId: config.accessKey,
		secretAccessKey: config.secretKey,
	});

	await getOriginals(s3, lastRan, async ({ key }) => {
		process.stdout.write('\x1b[2m' + key + '\x1b[0m');
		process.stdout.write(' downloading...');
		await downloadOriginal(s3, key);
		process.stdout.write(' \x1b[32mdone\x1b[0m');
		process.stdout.write(' optimizing...');
		await transform(key);
		process.stdout.write(' \x1b[32mdone\x1b[0m');
		process.stdout.write(' uploading...');
		await uploadTransformed(s3, key);
		process.stdout.write(' \x1b[32mdone\n\x1b[0m');
	});
})();
