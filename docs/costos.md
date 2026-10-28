# Costos de EC2 en Ohio

Valores consultados el 28 de octubre de 2026 en los catálogos públicos de AWS. Región `us-east-2`, zona `us-east-2a`; la SCP no permite trasladar el cálculo a otra región. Moneda USD, sin impuestos, descuentos privados ni garantía de cobertura Free Tier.

## Evidencia observada

El equipo reportó **US$0,00 de costo observado bajo Free Tier**. La [captura original del Budget](budget.png) confirma la creación de **My Zero-Spend Budget**, límite **US$1,00**, estado OK y uso al 0 %. Las columnas de importe están en «-»: no es una factura conciliada ni demuestra por sí sola consumo gratuito permanente. No se consultó Billing de la cuenta desde este cambio. Conservar Bills/Cost Explorer al cerrar el evento para verificar el importe final, créditos, periodo y destinatarios reales de alerta.

## Tarifas y fórmulas

| Recurso | Tarifa de referencia | Cálculo antes de créditos |
|---|---:|---|
| EC2 t3.micro Linux On-Demand, Ohio | US$0,0104/h | `horas × 0,0104` |
| IPv4 pública | US$0,005/h por dirección | `direcciones × horas × 0,005` |
| EBS gp3, almacenamiento base | US$0,08/GB-mes | `GB × 0,08 × fracción del mes`; IOPS/throughput extra aparte |
| DynamoDB Standard On-Demand, escrituras | US$0,625/millón WRU | `WRU × 0,625 / 1.000.000` |
| DynamoDB Standard On-Demand, lecturas | US$0,125/millón RRU | `RRU × 0,125 / 1.000.000` |
| DynamoDB Standard, almacenamiento | US$0,25/GB-mes por encima de los primeros 25 GB gratuitos indicados en catálogo | `max(0, GB−25) × 0,25` |
| CloudWatch Logs Standard, primera banda | US$0,50/GB ingerido; US$0,03/GB-mes almacenado | `GB ingeridos × 0,50 + GB-mes retenidos × 0,03` |
| CloudWatch, alarma estándar | US$0,10 por métrica-alarma/mes | `alarmas × 0,10`; cuatro en el script, antes de franquicias |
| CloudWatch, métrica personalizada, primera banda | US$0,30/métrica-mes | `métricas × 0,30`; dos filtros de logs en el script |

El catálogo EC2 para Ohio identifica t3.micro como 2 vCPU y 1 GiB, no 2 GiB. Fuentes: [precio EC2 Linux Ohio](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20%28Ohio%29/Linux/index.json), [DynamoDB Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/us-east-2/index.json), [CloudWatch Ohio](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-2/index.json), [IPv4](https://aws.amazon.com/vpc/pricing/), [EBS](https://aws.amazon.com/ebs/pricing/). El dominio del catálogo `pricing.us-east-1.amazonaws.com` aloja la lista pública; los datos consultados corresponden a `us-east-2`, no despliegan recursos en Virginia.

EBS usa la tarifa base publicada de gp3; confirmar el volumen y la tarifa seleccionada en Calculator. No hay evidencia aquí del tamaño real del volumen EC2, así que no se presenta un total medido de EBS. Transferencia saliente, snapshots EBS, SNS, créditos CPU excedentes T3 Unlimited y consultas CloudWatch se agregan según uso; no se incluyen como si fueran cero. Caddy y PM2 no generan un servicio AWS separado. ECS, ALB, ECR, S3 y CloudFront no son componentes obligatorios de este despliegue.

## Costo de nuestros snapshots

Tabla `spookython-manta-state`, región Ohio. Claves físicas verificadas: `gameId` (S) / `turnId` (N); PK/SK se conserva como identidad lógica del adaptador. Se persiste gzip binario de estado dinámico, sin repetir el grafo. Cada commit escribe el manifiesto y `META#LATEST/SNAPSHOT` mediante transacción: una escritura transaccional cuesta el doble de WRU ordinarias. Para un checkpoint sin fragmentación, siendo `S` el tamaño del ítem y `P` el del puntero, en bytes:

```text
WRU_por_commit = 2 × ceil(S / 1024) + 2 × ceil(P / 1024)
WRU_total = suma(WRU_por_commit) + WRU_de_fragmentos + WRU_de_reintentos
RRU_recuperación = suma(ceil(tamaño_ítem / 4096))  # GetItem consistente
costo_DDB = WRU_total × 0,625/1e6 + RRU_total × 0,125/1e6 + almacenamiento
```

Si hay fragmentos, `S` es el manifiesto pequeño y cada fragmento se cobra como PutItem ordinario. Contar los nombres de atributos y claves en el tamaño facturable; el tamaño JSON del mundo sin comprimir no equivale al tamaño del ítem. Tres rondas generan 450 commits de turno, más turno 0 y controles. Reintentos, revisiones del mismo turno y fragmentos huérfanos pueden añadir escrituras/almacenamiento. Fuentes: [unidades de lectura/escritura](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/read-write-operations.html) y [precios DynamoDB](https://aws.amazon.com/dynamodb/pricing/on-demand/).

## Ejemplo presupuestario, no factura

Con 730 h de EC2, una IPv4 y **8 GB gp3 hipotéticos**, el subtotal mensual es `730×0,0104 + 730×0,005 + 8×0,08 = US$11,882`, antes de DynamoDB, CloudWatch, transferencia y créditos. No sustituye el dato observado de US$0,00: muestra la exposición sin beneficios. El volumen de 8 GB es un supuesto explícito, no una medición de la instancia.

Antes del evento, cargar la configuración y horas reales en [AWS Pricing Calculator](https://calculator.aws/), registrar enlace/exportación y conciliar con Bills. Detener EC2 no elimina cargos de EBS, snapshots ni una Elastic IP retenida. El Budget alerta; no impone un límite duro. Ver [operación y rollback](operacion-rollback.md).
