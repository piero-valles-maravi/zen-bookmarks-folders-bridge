<div align="center">

![Bookmarks Folders Bridge](assets/banner.svg)

# Bookmarks Folders Bridge

**Mueve carpetas entre la barra lateral de pestañas de Zen y la barra de marcadores — conservando toda su estructura anidada.**

![version](https://img.shields.io/badge/versión-1.0.0-6D28D9)
![Zen Browser](https://img.shields.io/badge/Zen-Browser-4338CA)
![Sine](https://img.shields.io/badge/Sine-mod-F59E0B)
![license](https://img.shields.io/badge/licencia-MIT-3DA639)

</div>

---

## ✨ ¿Qué hace?

Zen te deja organizar pestañas en **carpetas** dentro de la barra lateral, y también guardar **marcadores** en carpetas en la barra de marcadores. Pero mover una carpeta de un lado al otro, a mano, es tedioso.

Este mod añade dos opciones al menú contextual (clic derecho) que hacen el puente en **ambos sentidos**, respetando subcarpetas y pestañas:

![Flujo bidireccional](assets/flow.svg)

| Dirección | Dónde haces clic derecho | Opción | Resultado |
|---|---|---|---|
| **Pestañas → Marcadores** | Una carpeta en la barra lateral | 📌 *Guardar en Marcadores…* | Crea una copia de la carpeta (con subcarpetas y pestañas) como marcadores. |
| **Marcadores → Pestañas** | Una carpeta en la barra de marcadores | 📂 *Abrir como carpeta de pestañas…* | Recrea la carpeta como pestañas ancladas dentro del workspace que elijas. |

---

## 🎯 Características

- **Bidireccional:** de pestañas a marcadores y viceversa.
- **Estructura preservada:** las subcarpetas anidadas se mantienen en ambos sentidos.
- **No destructivo:** guardar no cierra tus pestañas y abrir no borra tus marcadores — siempre crea una copia.
- **Elige el destino:** un selector con árbol te deja escoger en qué carpeta de marcadores guardar, o en qué **workspace** (y subcarpeta) abrir.
- **Limpia el ruido:** ignora pestañas vacías (`about:newtab`, `about:blank`) al guardar.

---

## 📋 Requisitos

- **[Zen Browser](https://zen-browser.app/)**
- **Sine** (gestor de mods para Zen) instalado.
- En `about:config`, la opción **`sine.allow-unsafe-js`** en **`true`** (necesaria porque el mod usa un script `*.uc.js`).

---

## 🚀 Instalación

### Opción A — Con Sine desde GitHub (recomendada)

1. Abre Zen y entra al **gestor de mods de Sine** (en `Configuración de Zen → Sine`, o desde el ícono de Sine).
2. Busca la opción para **instalar un mod desde un repositorio de GitHub**.
3. Pega el identificador del repo:
   ```
   piero-valles-maravi/zen-bookmarks-folders-bridge
   ```
4. Confirma la instalación y **reinicia Zen** si te lo pide.
5. Verifica que en `about:config` esté `sine.allow-unsafe-js = true`.

### Opción B — Instalación manual

1. Descarga este repositorio (**Code → Download ZIP**) o clónalo:
   ```bash
   git clone https://github.com/piero-valles-maravi/zen-bookmarks-folders-bridge.git
   ```
2. Copia la carpeta dentro del directorio de mods de Sine de tu perfil de Zen:
   ```
   <perfil de Zen>/chrome/sine-mods/bookmarks-folders-bridge/
   ```
   > 💡 Para encontrar tu perfil, abre `about:profiles` en Zen y busca la carpeta raíz del perfil (*Root Directory*).
3. Asegúrate de que `sine.allow-unsafe-js` esté en `true` en `about:config`.
4. Reinicia Zen (o recarga los mods desde Sine).

---

## 🖱️ Uso

### Guardar una carpeta de pestañas en marcadores
1. Clic derecho sobre cualquier **carpeta de la barra lateral**.
2. Elige **📌 Guardar en Marcadores…**.
3. En el árbol, selecciona la carpeta de marcadores destino.
4. Pulsa **Guardar**.

### Abrir una carpeta de marcadores como pestañas
1. Clic derecho sobre cualquier **carpeta de la barra de marcadores**.
2. Elige **📂 Abrir como carpeta de pestañas…**.
3. Selecciona el **workspace** destino.
4. *(Opcional)* Selecciona una subcarpeta donde anidarla; si no, se crea en la raíz del workspace.
5. Pulsa **Abrir**.

> 📸 *¿Quieres ver capturas reales? Puedes añadirlas en `assets/` y enlazarlas aquí.*

---

## ⚙️ Preferencias

Disponibles en la configuración del mod dentro de Sine:

| Preferencia | Por defecto | Descripción |
|---|---|---|
| Incluir pestañas vacías al guardar | `off` | Si se incluyen pestañas `about:newtab` / `about:blank` al guardar en marcadores. |
| Abrir pestañas importadas en segundo plano | `on` | Si las pestañas creadas al importar se abren sin robar el foco. |

---

## 📝 Notas y limitaciones

- Guardar una carpeta de pestañas en marcadores **no** cierra las pestañas: crea una copia como marcadores.
- Abrir una carpeta de marcadores **no** borra los marcadores: solo crea pestañas nuevas.
- Las pestañas vacías (`about:newtab`, `about:blank`) se excluyen al guardar.
- Diseñado para versiones recientes de Zen con la API de *workspaces* y *folders*; en versiones muy antiguas puede no funcionar.

---

## 🗑️ Desinstalación

Desde el gestor de mods de Sine, desactiva o elimina **Bookmarks Folders Bridge**. Si lo instalaste manualmente, borra la carpeta `chrome/sine-mods/bookmarks-folders-bridge/` de tu perfil y reinicia Zen.

---

## 👤 Autor · Licencia

Creado por **[@piero-valles-maravi](https://github.com/piero-valles-maravi)**.

Publicado bajo la licencia **[MIT](LICENSE)** — puedes usarlo, modificarlo y compartirlo libremente, conservando el aviso de copyright.
