# Configuración de infraestructura

Los valores del despliegue EC2 confirmado están centralizados en
[infra/.env.example](../../infra/.env.example) y documentados en
[infra/README.md](../../infra/README.md).

Usar `AWS_REGION=us-east-2`, zona EC2 `us-east-2a` y
`DYNAMODB_TABLE_NAME=spookython-manta-state`. La base pública es
`https://3-128-78-190.sslip.io`; el WebSocket del backend está en
`wss://3-128-78-190.sslip.io/ws`.
