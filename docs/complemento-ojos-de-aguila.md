# Complemento para el hackatón: Ojos de Águila en Manta

**Estado:** rebanada vertical simulada implementada en `design`; no existe conexión a cámaras reales ni acceso a video.

## Contexto

En Manta, el GAD municipal identifica su red como el **Sistema de Videovigilancia Ojos de Águila**. El ECU 911 describe la videovigilancia como apoyo para observar incidentes y coordinar la respuesta con las instituciones articuladas. En 2024, el ECU 911 informó que Manta recibió autorización para adquirir sistemas de videovigilancia y avanzar en su interoperabilidad; esa autorización es un paso para la adquisición, no evidencia de que este proyecto tenga acceso a las cámaras.

## Propuesta para Escape de Manta Zombie

El mapa publica una capa de **cámaras simuladas** en referencias aproximadas. Después del movimiento de zombies, cuando uno activo queda en el radio simulado de un sensor habilitado, el backend registra una observación temporal con cámara, zombie, nodo, turno de detección y vencimiento. Routing evita el nodo observado durante la vigencia de la alerta; el snapshot muestra radios, estado y detecciones activas.

Para la demo, los puntos de cámara y detecciones son sintéticos o basados en referencias públicas aproximadas. La rebanada no necesita video real: representa el flujo «detección → alerta → actualización del riesgo → ruta de evacuación». Así se conecta el sistema de monitoreo con el mapa y el motor de rutas que ya tiene el proyecto.

## Ubicaciones públicas y límites

Sí hay referencias públicas puntuales, pero no encontré un inventario georreferenciado completo de la red Ojos de Águila con coordenadas, orientación, cobertura y estado operativo actual. En agosto de 2025, el GAD Manta publicó cuatro sitios donde ubicó cámaras para controlar basurales; el boletín describe esa instalación específica y no confirma que esos equipos pertenezcan a Ojos de Águila. Una ficha de transparencia municipal registra el servicio de cámaras y un trámite por solicitud institucional, pero no ofrece un mapa descargable de ubicaciones.

Por eso, un punto publicado sirve únicamente como referencia aproximada para un escenario de prueba, con fuente y fecha visibles. No conviene inferir el campo visual, la cobertura real ni el estado actual de cada cámara a partir de una dirección. La autorización que el ECU 911 reportó para que Manta adquiera sistemas es un paso de adquisición e interoperabilidad; no concede acceso público a imágenes o transmisiones. En este repositorio, la capa local solo muestra radios sintéticos y alertas del juego; no integra video ni infraestructura municipal.

## Implementación en esta rebanada

1. El fixture asocia cada referencia habilitada al nodo más cercano y conserva su precisión estimada y distancia de ajuste.
2. La detección compara distancia geográfica al nodo asociado con el radio sintético configurado; solo considera zombies activos.
3. La observación se sincroniza con routing y el nodo detectado es temporalmente inaccesible para nuevas rutas. Se renueva mientras siga la detección y vence al salir del área.
4. El snapshot y el mapa identifican ubicaciones, radios y alertas como simulados. No dibujan orientación ni campo visual oficial.

El fixture inicial está en [`backend/data/camaras_ojos_de_aguila.manta.json`](../backend/data/camaras_ojos_de_aguila.manta.json). Incluye cuatro referencias publicadas; tres se asocian al nodo más cercano del grafo actual y la referencia de Paquisha queda como referencia sin cobertura porque está fuera del grafo peatonal actual. El comportamiento de esta rebanada es implementado localmente; no está desplegado ni verificado con infraestructura municipal.

## Texto breve para presentar

> Tomamos como referencia el sistema Ojos de Águila de Manta y la coordinación de videovigilancia del ECU 911. Proponemos una capa de cámaras simuladas que alerte cuando una amenaza entra en cobertura y ayude a actualizar las rutas de evacuación en el mapa. La demo usa ubicaciones y detecciones de prueba; no se conecta a cámaras reales.

## Fuentes

- GAD Manta, transparencia institucional (mar. 2021): [Cámaras del Sistema de Video Vigilancia Ojos de Águila de Manta](https://manta.gob.ec/db/municipio/transparencia/lotaip/2021/MARZO/literales/02p/LOTAIP%20MES%20DE%20MARZO%20DEL%20%20%202021%20%28TODAS%20LAS%20DIRECCIONES%29%20.pdf).
- Alcaldía de Manta (12 ago. 2025): [cámaras en puntos críticos de basurales](https://manta.gob.ec/habla-serio-y-mira-la-camara-que-te-estamos-vigilando/), referencia puntual de ubicaciones.
- SIS ECU 911: [Cámaras de videovigilancia](https://www.ecu911.gob.ec/camaras-de-videovigilancia/), descripción del monitoreo de incidentes y su articulación con las instituciones competentes.
- SIS ECU 911: [Manta recibe autorización para adquirir sistemas de videovigilancia](https://www.ecu911.gob.ec/3-gobiernos-autonomos-descentralizados-reciben-autorizacion-del-ecu-911-para-la-adquisicion-de-sistemas-de-videovigilancia/), bajo el marco de interoperabilidad de 2024.
- SIS ECU 911: [Informe de rendición de cuentas 2024, Coordinación Zonal 4](https://www.ecu911.gob.ec/wp-content/uploads/2025/06/INFORME_RENDICION_DE_CUENTAS_2024_CZ4.pdf), registra monitoreo y coordinación de cámaras en la Sala Operativa Manta.
