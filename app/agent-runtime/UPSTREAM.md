# Este directorio es un fork de hermes-agent

Runtime del agente de Niki. Es una copia modificada de
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), vendorizada
dentro del repo para que Niki no dependa de un proceso ni de un estado que viven fuera
del proyecto.

| | |
|---|---|
| Upstream | `https://github.com/NousResearch/hermes-agent.git` |
| Commit de origen | `f2fdb9a17` — *feat(gateway): deliverable mode (#27813)* |
| Versión | 0.14.0 |
| Fecha del fork | 2026-08-13 |
| Licencia | MIT — Copyright (c) 2025 Nous Research (ver `LICENSE`) |

## Por qué está acá y no en `~/.hermes`

Niki dependía de un gateway externo en `127.0.0.1:8642` con su estado en el home del
usuario. Había que levantarlo aparte, no era del proyecto, y cayéndose dejaba a Niki
muda sin decir por qué. Ahora el runtime es parte de Niki: lo arranca y lo supervisa el
backend, y su estado vive en `app/backend/agent-home/`.

El Hermes personal de Esteban en `~/.hermes` **sigue existiendo y es suyo**. Son dos
instalaciones separadas, con puertos y `HERMES_HOME` distintos.

## Cómo encontrar nuestros cambios

Todo lo que tocamos lleva un comentario `# NIKI:` explicando el porqué. Para verlos:

```bash
grep -rn "# NIKI:" app/agent-runtime --include=*.py
```

La regla es mantener los cambios **mínimos y localizados**. Cada archivo que tocamos es
un archivo que va a dar conflicto la próxima vez que traigamos upstream, así que si algo
se puede resolver por configuración (`HERMES_HOME`, `API_SERVER_PORT`,
`enabled_toolsets`) se resuelve por configuración y no editando código.

El árbol se mantiene **idéntico a upstream** salvo por esos cambios: no borramos
carpetas que no usamos (`website/`, `web/`, `ui-tui/`) aunque pesen, porque borrarlas
convierte cada actualización en una pelea de conflictos por 30 MB de ahorro.

## Cómo traer cambios de upstream

Upstream está activo, así que esto va a hacer falta.

```bash
# 1. Traer el árbol nuevo a un directorio aparte
git clone --depth 50 https://github.com/NousResearch/hermes-agent.git /tmp/hermes-upstream

# 2. Ver qué cambió desde nuestro punto de partida
git -C /tmp/hermes-upstream log --oneline f2fdb9a17..HEAD

# 3. Ver si toca alguno de los archivos que modificamos
grep -rl "# NIKI:" app/agent-runtime --include=*.py | sed 's|app/agent-runtime/||' > /tmp/nuestros.txt
git -C /tmp/hermes-upstream diff --name-only f2fdb9a17..HEAD | grep -Ff /tmp/nuestros.txt

# 4. Sincronizar, revisando a mano lo que aparezca en el paso 3
rsync -a --exclude='venv/' --exclude='.git/' --exclude='__pycache__/' \
      /tmp/hermes-upstream/ app/agent-runtime/

# 5. Reaplicar nuestros cambios donde el paso 3 haya avisado, y actualizar
#    el commit de origen en la tabla de arriba.
```

Después de sincronizar, correr la verificación de la sección siguiente antes de dar el
cambio por bueno.

## Entorno

Python >= 3.11. Las dependencias las declara el propio proyecto en `pyproject.toml` y
`uv.lock`; no mantenemos un `requirements.txt` paralelo, que se desincronizaría.

```bash
cd app/agent-runtime
python3 -m venv venv
./venv/bin/pip install -e . aiohttp "mcp==1.26.0"
```

Dos dependencias que no vienen en las básicas y Niki sí necesita:

- **aiohttp** — sin él el gateway arranca pero no sirve `/v1/runs`; avisa con un warning
  fácil de pasar por alto. Está en el extra `[messaging]`, que arrastra Telegram y
  Discord; se instala suelto.
- **mcp==1.26.0** — la versión exacta que pide `pyproject.toml`. Con la 2.0 las
  herramientas MCP fallan con `'CallToolResult' object has no attribute 'isError'`: el
  SDK renombró el campo a `is_error` y el runtime todavía usa el nombre viejo. El error
  aparece recién al invocar una herramienta, no al conectar.

El `venv/` está en `.gitignore`.

## Verificación mínima tras tocar el fork

```bash
cd app/agent-runtime
./venv/bin/python -c "import hermes_cli, agent; print('import OK')"
./venv/bin/python -m hermes_cli.main --help >/dev/null && echo "cli OK"
```

Y desde el backend, que el runtime levante y responda `/v1/health` en su puerto.
