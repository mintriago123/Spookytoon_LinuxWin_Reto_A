# Configuración del despliegue EC2

El equipo confirmó estos valores el 28 de octubre de 2026:

| Configuración | Valor |
|---|---|
| Región admitida por la SCP (`AWS_REGION`) | `us-east-2` — Ohio |
| Zona de disponibilidad de la instancia (`AWS_AVAILABILITY_ZONE`) | `us-east-2a` |
| Tabla activa (`DYNAMODB_TABLE_NAME`) | `spookython-manta-state` |
| Base HTTPS (`PUBLIC_API_URL`) | `https://3-128-78-190.sslip.io` |
| Base WSS (`PUBLIC_WS_BASE_URL`) | `wss://3-128-78-190.sslip.io` |
| Canal WS (`PUBLIC_WS_URL`) | `wss://3-128-78-190.sslip.io/ws` |

La plantilla está en [.env.example](.env.example); el backend tiene su propia
plantilla en [backend/.env.example](../backend/.env.example), incluyendo la
clave de operador/routing. Estas variables se deben cargar en el entorno del
proceso o mediante `node --env-file=.env src/server.ts` desde `backend/`.

La entrada pública HTTPS/WSS de EC2 debe reenviar HTTP a
`127.0.0.1:3001` y permitir el upgrade del canal `/ws`. La API pública de
lectura está en `https://3-128-78-190.sslip.io/estado`; los controles conservan
la autenticación `x-api-key`. `FRONTEND_ORIGIN` debe coincidir con el origen
real del navegador; la plantilla usa el dominio confirmado de EC2.

DynamoDB es regional: su cliente debe usar `AWS_REGION=us-east-2` y la tabla
`spookython-manta-state`. `us-east-2a` identifica la zona de EC2, no una región
válida para el cliente DynamoDB.

`PUBLIC_*` documenta los endpoints que deben utilizar los consumidores y las
herramientas de despliegue; esas variables no configuran TLS dentro de Fastify.
La SCP y la existencia de la tabla se registran según la verificación del
equipo. Esta configuración no crea recursos ni modifica políticas de AWS.

El adaptador DynamoDB, la recuperación y la cola están implementados en
`backend/src/modules/persistence/`. Los scripts de esta carpeta preparan releases,
Caddy, PM2, políticas y alarmas; su existencia no significa que se hayan aplicado
en AWS. Ver [operación y rollback](../docs/operacion-rollback.md),
[costos](../docs/costos.md) y [diagrama](../docs/arquitectura.drawio).

Los scripts de release extraen commits ya versionados: cambios locales sin commit
no viajan al despliegue. No contienen credenciales y nunca crean un segundo escritor.
