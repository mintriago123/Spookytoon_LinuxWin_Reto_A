# Verificación local de fase 3E

Rama `prueba`, HEAD `0ca1c50`, con cambios locales sin commit de fases 1, 2 y 3.
Node 24.12.0 descargado temporalmente en `/tmp`; no se instalaron dependencias nuevas.
No demuestra estado de producción ni revisión visual del frontend.

- Frontend: 58 pruebas, lint y build pasan.
- Backend: typecheck pasa.
- Runtime: sus 27 pruebas pasaron en la ejecución dirigida.
- Casos nuevos de reinicio/repetición: pasan. Incluyen modos distintos, fuente guardada
  frente a preset vigente, semilla, identidad, reinicios competidores, reconstrucción inicial
  de entidades/reservas/eventos y fallos de construcción sin sustituir la partida anterior.
- Primera suite completa backend: 55/56; R2 falló en la assertion de cero incumplimientos
  de deadline al cerrar la pausa. No se conservó el log completo de esa primera pasada en
  un archivo; el runner informó `1 !== 0` en `backend/tests/server-e2e.test.ts:187`.
- Repetición aislada de R2: pasa. Commit de pausa 0,154 ms después de la frontera, con
  tolerancia 10 ms, sin incumplimiento.
- Repetición completa backend: 56/56. Pausas R1/R2/R3 con commitDelayMs de
  0,216 / 0,222 / 0,109; p95 de cierre 13,5 / 62,1 / 113 ms.

No se cambiaron assertions, tolerancia de 10 ms, timeout individual, SLA, reloj ni
datos del escenario para estas repeticiones. No se establece la causa del primer fallo;
un resultado posterior verde no demuestra ausencia de variabilidad temporal.

Logs adjuntos: `spooky-stage3e-r2.log` y `spooky-stage3e-backend.log`.
Se generaron mediante:

```sh
node --test --test-isolation=none --test-name-pattern='R2:' backend/tests/server-e2e.test.ts
node --test --test-isolation=none backend/tests/*.test.ts
```

La ejecución usa sockets de loopback fuera del sandbox. Las pruebas DynamoDB emplean
transportes simulados; no se modificó AWS. La confirmación/cancelación de interfaz sigue
pendiente de revisión manual, al igual que las comprobaciones visuales anteriores del mapa.
