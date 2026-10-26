# Costos AWS — plantilla de estimación y conciliación

Completar con región, configuración desplegada y duración real antes de activar recursos. No usar precios de otra región ni presentar este documento vacío como presupuesto aprobado.

## Parámetros que deben fijarse

| Parámetro | Valor |
|---|---|
| AWS_REGION elegida | Pendiente |
| Horas con tarea activa (incluye pruebas y demo) | Pendiente |
| ECS Fargate: vCPU / memoria / tareas | Pendiente de medición; SPEC propone comenzar en 2 vCPU / 2 GiB |
| Partidas y snapshots esperados | Pendiente |
| Solicitudes estáticas y tráfico CloudFront | Pendiente |
| Límite del AWS Budget y periodo | Pendiente |
| Fecha de consulta de precios | Pendiente |

## Recursos para AWS Pricing Calculator

| Servicio | Variables de cálculo |
|---|---|
| ECS Fargate | Región, vCPU, memoria, número de tareas y horas encendidas |
| Application Load Balancer | Horas activo, LCU promedio, tráfico HTTPS/WSS |
| DynamoDB On-Demand | Escrituras/lecturas por turno, tamaño de snapshot, retención |
| CloudWatch | Ingesta/retención de logs, métricas y alarmas |
| S3 | Tamaño de build, almacenamiento y solicitudes |
| CloudFront | Transferencia por región de usuario, requests y caché |
| ECR / Secrets Manager | Almacenamiento de imagen y secretos activos |

Total estimado = suma de servicios para la región y las horas de uso elegidas. Incluir en la estimación el periodo de pruebas y la ventana en que la tarea quedará caliente; no calcular solo los cinco minutos de una ronda.

## AWS Budget y evidencia

Crear un AWS Budget con límite y periodo aprobados por el equipo, alertas antes de alcanzar el límite y destinatario operativo. Guardar una captura real que muestre nombre del Budget, periodo, límite, alertas configuradas y región cuando la consola lo exponga. No incluir datos de pago ni secretos.

Guardar la captura en **docs/evidence/aws-budget.png**. Registrar debajo:

| Evidencia | Valor |
|---|---|
| Región | Pendiente |
| Budget / periodo / límite | Pendiente |
| Estimado Calculator | Pendiente |
| Costo observado al cierre | Pendiente |
| Diferencia y causa | Pendiente |
| Fecha de conciliación | Pendiente |

La estimación y el costo observado deben corresponder a la misma configuración y ventana de uso. Ajustar recursos o retención si la diferencia no se explica.
