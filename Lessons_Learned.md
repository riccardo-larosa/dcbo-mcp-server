As of Oct 16 we have a working version of a simple mcp server that can follow the oauth2 flow in mcp inspector and obtain an authorization code. 
In order to do that we made a few assumptions: 

# In Development
## Metadata Discovery
OAuth Metadata Sources
Resource Metadata:
From http://localhost:3000/.well-known/oauth-protected-resource
```json
{
  "resource": "http://localhost:3000/mcp",
  "authorization_servers": [
    "http://localhost:3000/oauth2"
  ]
}
```
Authorization Server Metadata:
From http://localhost:3000/.well-known/oauth-authorization-server
```json
{
  "issuer": "http://localhost:3000/oauth2",
  "authorization_endpoint": "http://localhost:3000/oauth2/authorize",
  "token_endpoint": "http://localhost:3000/oauth2/token",
  "scopes_supported": [
    "api"
  ],
  "response_types_supported": [
    "code"
  ],
  "grant_types_supported": [
    "authorization_code",
    "password",
    "refresh_token"
  ],
  "token_endpoint_auth_methods_supported": [
    "client_secret_post",
    "client_secret_basic"
  ],
  "code_challenge_methods_supported": [
    "S256"
  ],
  "client_id": "my-mcp-server",
  "client_secret": "SECRET_FROM_OAUTH2_DISCOVERY"
}
```
Since Docebo doesn't support Dynamic Client Registration, we get
## Client Registration
Registered Client Information
```json
{
  "client_id": "my-mcp-server",
  "client_secret": "SECRET_FROM_OAUTH2_DISCOVERY"
}
```
The we get this url to past in a browser window
```
http://localhost:3000/oauth2/authorize?response_type=code&client_id=my-mcp-server&code_challenge=3eF3AqWz1HVjE-A43KjeycUCjPjV8-t9oQ2sAlal5_g&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A6274%2Foauth%2Fcallback%2Fdebug&state=482ca2ccea9a835506e02186d93a3494df36fb10a60f79c4243ed539994cc556&scope=api&resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp
```
which of course it would never work because my localhost is not an oauth provider. So we have to replace
http://localhost:3000 with https://tenantId.docebosaas.com 
Also don't forget to encode the resource value
And we have to replace
redirect_uri with the value that we used in Docebo when we registered the oauth2 client "my-mcp-server". 
So we have something like this:
```
https://tenantid.docebosaas.com/oauth2/authorize?response_type=code&client_id=my-mcp-server&code_challenge=2xp_qH4QB-_N87ou-1f1xAtBgtQnuwIxwGmsY3yC6NE&code_challenge_method=S256&redirect_uri=https%3A%2F%2Funreproductive-floyd-nonfictively.ngrok-free.dev%2Foauth%2Fcallback%2Fdebug&state=08de6779339f38fae404862559a77a13cf806469f3e61da724d50a145fd8a9e1&scope=api&resource=https%3A%2F%2Funreproductive-floyd-nonfictively.ngrok-free.dev%2Fmcp
```
This will allow to go through the flow and get an authorization code.

## Token Request

This code then has to be exchanged for a token by calling
```bash
curl -X POST 'https://riccardo-lr-test.docebosaas.com/oauth2/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'code=AUTHORIZATION_CODE_HERE' \
  -d 'client_id=my-mcp-server' \
  -d 'client_secret=SECRET_FROM_OAUTH2_DISCOVERY' \
  -d 'redirect_uri=https://unreproductive-floyd-nonfictively.ngrok-free.dev/oauth/callback/debug'
```
and finally this is used by our MCP Server as a header value for:
Authorization: Bearer <TOKEN_HERE>

We can then go and get the tools_list, etc

# In Production
We need to test all of this in production. 
According to this article https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers Claude now 

As of July, users are also able to specify a custom client ID and client secret when configuring a server that doesn’t support DCR.

So until Docebo supports 
OAuth 2.0 Protected Resource Metadata (RFC9728)
OAuth 2.0 Authorization Server Metadata (RFC8414)
we may have to test and see if we can pass this information in the configuration settings

A good example in production is what zapier is doing with 
https://mcp.zapier.com/.well-known/oauth-protected-resource
and
https://mcp.zapier.com/.well-known/oauth-authorization-server
