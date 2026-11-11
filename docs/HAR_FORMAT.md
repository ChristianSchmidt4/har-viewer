# HTTP Archive (HAR) Format Specification

This document describes the HAR 1.2 format used by the HAR Viewer application.

## Overview

HAR (HTTP Archive) is a JSON-formatted archive file format for logging of a web browser's interaction with a site. It contains detailed performance data, mostly used for web page performance audits.

## Structure

```json
{
  "log": {
    "version": "1.2",
    "creator": { ... },
    "browser": { ... },
    "pages": [ ... ],
    "entries": [ ... ]
  }
}
```

## Log Object

| Property | Type | Description |
|----------|------|-------------|
| version | string | Version of the HAR specification (required) |
| creator | object | Creator of the HAR file (required) |
| browser | object | Browser used (optional) |
| pages | array | List of pages visited (optional) |
| entries | array | List of network requests (required) |
| comment | string | Comment provided by the user or application (optional) |

## Creator/Browser Object

| Property | Type | Description |
|----------|------|-------------|
| name | string | Name of the application (required) |
| version | string | Version of the application (required) |
| comment | string | Comment (optional) |

## Page Object

| Property | Type | Description |
|----------|------|-------------|
| startedDateTime | string | Date and time stamp for the beginning of the page load (ISO 8601 format) (required) |
| id | string | Unique identifier for the page (required) |
| title | string | Page title (required) |
| pageTimings | object | Detailed timing info about page load (required) |
| comment | string | Comment (optional) |

## Entry Object

| Property | Type | Description |
|----------|------|-------------|
| pageref | string | Reference to the parent page (optional) |
| startedDateTime | string | Date and time stamp of the request start (ISO 8601) (required) |
| time | number | Total elapsed time of the request in milliseconds (required) |
| request | object | Detailed info about the request (required) |
| response | object | Detailed info about the response (required) |
| cache | object | Info about cache usage (optional) |
| timings | object | Detailed timing info about request-response cycle (required) |
| serverIPAddress | string | IP address of the server (optional) |
| connection | string | Unique ID of the connection (optional) |
| comment | string | Comment (optional) |

## Request Object

| Property | Type | Description |
|----------|------|-------------|
| method | string | Request method (GET, POST, ...) (required) |
| url | string | Absolute URL of the request (required) |
| httpVersion | string | Request HTTP Version (required) |
| cookies | array | List of cookie objects (optional) |
| headers | array | List of header objects (optional) |
| queryString | array | List of query parameter objects (optional) |
| postData | object | Posted data info (optional) |
| headersSize | number | Total number of bytes from the start of the request message (required) |
| bodySize | number | Size of the request body (POST data payload) (required) |
| comment | string | Comment (optional) |

## Response Object

| Property | Type | Description |
|----------|------|-------------|
| status | number | Response status (required) |
| statusText | string | Response status description (required) |
| httpVersion | string | Response HTTP Version (required) |
| cookies | array | List of cookie objects (optional) |
| headers | array | List of header objects (optional) |
| content | object | Details about the response body (optional) |
| redirectURL | string | Redirect target URL (required) |
| headersSize | number | Total number of bytes from the start of response message (required) |
| bodySize | number | Size of the received response body in bytes (required) |
| comment | string | Comment (optional) |

## Content Object

| Property | Type | Description |
|----------|------|-------------|
| size | number | Length of the returned content in bytes (required) |
| compression | number | Number of bytes saved (optional) |
| mimeType | string | MIME type of the response text (required) |
| text | string | Response body sent from server or loaded from browser cache (optional) |
| encoding | string | Encoding used for the response text (optional) |
| comment | string | Comment (optional) |

## Cookie Object

| Property | Type | Description |
|----------|------|-------------|
| name | string | The name of the cookie (required) |
| value | string | The cookie value (required) |
| path | string | The path pertaining to the cookie (optional) |
| domain | string | The host of the cookie (optional) |
| expires | string | Cookie expiration time (optional) |
| httpOnly | boolean | True if cookie is HTTP only (optional) |
| secure | boolean | True if cookie is secure (optional) |
| comment | string | Comment (optional) |

## Header/Query String Object

| Property | Type | Description |
|----------|------|-------------|
| name | string | Name of the header/query string (required) |
| value | string | Value of the header/query string (required) |
| comment | string | Comment (optional) |

## Post Data Object

| Property | Type | Description |
|----------|------|-------------|
| mimeType | string | Mime type of posted data (required) |
| text | string | Plain text posted data (optional) |
| params | array | List of posted parameters (optional) |
| comment | string | Comment (optional) |

## Param Object

| Property | Type | Description |
|----------|------|-------------|
| name | string | Name of the parameter (required) |
| value | string | Value of the parameter (optional) |
| fileName | string | Name of the file (optional) |
| contentType | string | Content type of the file (optional) |
| comment | string | Comment (optional) |

## Cache Object

Contains info about a request coming from browser cache.

Empty object by default, may contain:
| Property | Type | Description |
|----------|------|-------------|
| beforeRequest | object | State of a cache entry before the request (optional) |
| afterRequest | object | State of a cache entry after the request (optional) |
| comment | string | Comment (optional) |

## Timings Object

| Property | Type | Description |
|----------|------|-------------|
| blocked | number | Time spent in a queue waiting for a network connection (optional) |
| dns | number | DNS resolution time (optional) |
| connect | number | Time required to create TCP connection (optional) |
| send | number | Time required to send HTTP request to the server (required) |
| wait | number | Waiting for a response from the server (required) |
| receive | number | Time required to read entire response from the server (required) |
| ssl | number | Time required for SSL/TLS negotiation (optional) |
| comment | string | Comment (optional) |

## Usage in HAR Viewer

The HAR Viewer application parses these objects to display:

1. Request list with key information (method, URL, status, size, time)
2. Detailed request/response headers
3. Response content
4. Timing breakdown
5. Performance metrics

All parsing is done client-side with no server requirements.