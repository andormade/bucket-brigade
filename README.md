# bucket brigade

## What does this do?

It takes image files from an Amazon S3 (or compatible) bucket, makes them smaller and then puts them into an other S3 compatible bucket.

## Required environment variables

- ACCESS_KEY
- SECRET_KEY
- AWS_ENDPOINT
- SOURCE_BUCKET
- DESTINATION_BUCKET

## Dependencies

- Ubuntu 20.04
- nodejs 14.15.3
- imagemagic
