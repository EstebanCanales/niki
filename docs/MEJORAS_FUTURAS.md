# Mejoras Futuras

## Funcionalidades pendientes

- Persistencia formal en base de datos SQL, por ejemplo PostgreSQL o SQLite.
- Sistema completo de usuarios con registro, recuperacion de cuenta y roles.
- Historial persistente de conversaciones.
- Adjuntos con subida real de archivos y procesamiento en backend.
- Calendario real integrado con Google Calendar o Apple Calendar.
- Automatizaciones persistentes con estado, historial y aprobacion.
- Empaquetado final de Niki Desktop y NikiNotch para distribucion.
- Pruebas automatizadas unitarias y de integracion.
- Docker Compose para levantar backend y servicios auxiliares.

## Posibles optimizaciones

- Reducir acoplamiento entre frontend web, app nativa y NikiNotch.
- Extraer contratos compartidos para evitar duplicar tipos entre TypeScript y Swift.
- Mejorar manejo de errores en streaming de chat y voz.
- Agregar cache y paginacion para listas grandes de tareas o actividades.
- Optimizar el pipeline de STT/TTS para menor latencia.
- Separar archivos pesados de modelos mediante descarga bajo demanda o Git LFS.
- Agregar observabilidad con logs estructurados, metricas y tracing.

## Ideas de evolucion del sistema

- Convertir Niki en un agente personal con memoria persistente por usuario.
- Agregar workspace multiusuario.
- Integrar herramientas externas como correo, calendario, archivos y navegacion.
- Crear widgets nativos para tareas, estado del agente y acciones rapidas.
- Agregar modo offline con sincronizacion posterior.
- Implementar un sistema de permisos para acciones sensibles.
- Publicar instaladores firmados para macOS.

## Mejoras de calidad de software

- Agregar pruebas para endpoints del backend.
- Agregar pruebas de componentes criticos del frontend.
- Configurar CI/CD en GitHub Actions.
- Documentar variables de entorno con ejemplos completos.
- Agregar convenciones de versionado y changelog.
- Definir reglas de arquitectura para nuevas features.

