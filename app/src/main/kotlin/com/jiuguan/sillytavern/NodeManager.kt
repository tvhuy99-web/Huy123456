package com.jiuguan.sillytavern

import android.content.Context
import android.util.Log
import android.util.Base64
import java.security.KeyStore
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

/**
 * Manages Node.js runtime and SillyTavern server lifecycle.
 *
 * Node.js binary: placed in jniLibs/arm64-v8a/libnode.so, Android extracts
 * it to nativeLibraryDir with execute permission automatically.
 *
 * SillyTavern: extracted from assets/sillytavern.zip to filesDir/sillytavern/
 */
class NodeManager(private val context: Context) {

    companion object {
        private const val TAG = "NodeManager"
        const val SERVER_PORT = 8001
        const val SERVER_HOST = "127.0.0.1"

        private const val ST_DIR = "sillytavern"
        private const val ST_SERVER = "sillytavern/server.js"
        private const val VERSION_FILE = "v2_version.txt"

        // Current bundle version - bump this to force re-extraction
        const val BUNDLE_VERSION = "1.19.0-1"
    }

    private var nodeProcess: Process? = null
    private val processOutput = mutableListOf<String>()

    val serverUrl: String get() = "http://$SERVER_HOST:$SERVER_PORT"

    /** Base directory for all V2 files */
    val baseDir: File get() = context.filesDir

    /** Node.js binary path - from nativeLibraryDir (has execute permission) */
    val nodeBinary: File get() = File(context.applicationInfo.nativeLibraryDir, "libnode.so")

    /** SillyTavern directory */
    val stDir: File get() = File(baseDir, ST_DIR)

    /** SillyTavern user data directory */
    val stDataDir: File get() = File(stDir, "data")

    /** Directory for Node.js shared libraries (extracted from assets) */
    val nodeLibsDir: File get() = File(baseDir, "nodelibs")

    /** Check if Node.js binary exists and is executable */
    fun isNodeInstalled(): Boolean {
        val exists = nodeBinary.exists()
        val canExec = nodeBinary.canExecute()
        Log.i(TAG, "Node check: path=${nodeBinary.absolutePath}, exists=$exists, canExecute=$canExec")
        return exists && canExec
    }

    /** Check if Node.js shared libraries are extracted */
    fun areNodeLibsInstalled(): Boolean {
        return nodeLibsDir.exists() && (nodeLibsDir.list()?.isNotEmpty() == true)
    }

    /** Check if SillyTavern is extracted */
    fun isSillyTavernInstalled(): Boolean {
        return File(baseDir, ST_SERVER).exists()
    }

    /** Check if everything is ready to run */
    fun isReady(): Boolean {
        return isNodeInstalled() && areNodeLibsInstalled() && isSillyTavernInstalled()
    }

    /** Check if the installed version matches the bundled version */
    fun isUpToDate(): Boolean {
        val versionFile = File(baseDir, VERSION_FILE)
        if (!versionFile.exists()) return false
        return try {
            versionFile.readText().trim() == BUNDLE_VERSION
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Extract SillyTavern from assets.
     * Expected asset: sillytavern.zip containing server.js, node_modules, etc.
     */
    suspend fun extractSillyTavern(onProgress: (String) -> Unit) = withContext(Dispatchers.IO) {
        // Install a new SillyTavern tree beside the currently working one.
        // Never erase the user's data or the last functional engine before
        // the new archive has been extracted and validated.
        val activeDir = stDir
        val stageDir = File(baseDir, "sillytavern-installing")
        val rollbackDir = File(baseDir, "sillytavern-rollback")
        val versionMarker = File(baseDir, VERSION_FILE)

        // Recover an interrupted update before trying again.
        if (rollbackDir.exists()) {
            val activeData = File(activeDir, "data")
            val rollbackData = File(rollbackDir, "data")
            if (activeData.exists() && !rollbackData.exists()) {
                if (!activeData.renameTo(rollbackData)) {
                    throw IOException("Cannot recover SillyTavern user data")
                }
            }
            if (activeDir.exists() && !activeDir.deleteRecursively()) {
                throw IOException("Cannot clean interrupted engine install")
            }
            if (!rollbackDir.renameTo(activeDir)) {
                throw IOException("Cannot restore previous SillyTavern engine")
            }
            Log.w(TAG, "Recovered last SillyTavern installation after interruption")
        }

        if (stageDir.exists() && !stageDir.deleteRecursively()) {
            throw IOException("Cannot clear interrupted SillyTavern staging directory")
        }
        if (!stageDir.mkdirs()) throw IOException("Cannot create staging directory")

        try {
            onProgress("Đang chuẩn bị SillyTavern 1.19.0...")
            val tmpZip = File(context.cacheDir, "sillytavern-1.19.0.zip")
            context.assets.open("sillytavern.zip").use { input ->
                FileOutputStream(tmpZip).use { output -> input.copyTo(output, 65536) }
            }
            try {
                FileInputStream(tmpZip).use { input -> extractZip(input, stageDir, onProgress) }
            } finally {
                tmpZip.delete()
            }

            val stageServer = File(stageDir, "server.js")
            val stagePackage = File(stageDir, "package.json")
            val stageModules = File(stageDir, "node_modules")
            if (!stageServer.isFile || !stagePackage.isFile || !stageModules.isDirectory) {
                throw IOException("SillyTavern 1.19.0 package is incomplete")
            }
            val version = org.json.JSONObject(stagePackage.readText()).optString("version")
            if (version != "1.19.0") {
                throw IOException("Expected SillyTavern 1.19.0 but package contains $version")
            }

            onProgress("Đang nâng cấp và giữ dữ liệu...")
            if (activeDir.exists() && !activeDir.renameTo(rollbackDir)) {
                throw IOException("Cannot move existing SillyTavern engine to backup")
            }
            if (!stageDir.renameTo(activeDir)) {
                if (rollbackDir.exists()) rollbackDir.renameTo(activeDir)
                throw IOException("Cannot activate updated SillyTavern engine")
            }

            val oldData = File(rollbackDir, "data")
            if (oldData.exists()) {
                val newData = File(activeDir, "data")
                if (newData.exists() && !newData.deleteRecursively()) {
                    throw IOException("Cannot replace default data with user data")
                }
                if (!oldData.renameTo(newData)) {
                    throw IOException("Cannot move existing user data to new engine")
                }
            }
            // Mark success only when source, dependencies AND data are installed.
            versionMarker.writeText(BUNDLE_VERSION)
            if (rollbackDir.exists() && !rollbackDir.deleteRecursively()) {
                Log.w(TAG, "Old engine retained in rollback directory")
            }
            Log.i(TAG, "SillyTavern 1.19.0 installed; data retained")
        } catch (e: Exception) {
            Log.e(TAG, "SillyTavern upgrade failed; restoring previous engine", e)
            if (rollbackDir.exists()) {
                val restoredData = File(activeDir, "data")
                val originalData = File(rollbackDir, "data")
                if (restoredData.exists() && !originalData.exists()) {
                    restoredData.renameTo(originalData)
                }
                if (activeDir.exists()) activeDir.deleteRecursively()
                if (!rollbackDir.renameTo(activeDir)) {
                    Log.e(TAG, "Automatic rollback failed: saved engine at ${rollbackDir.absolutePath}")
                }
            }
            throw e
        } finally {
            if (stageDir.exists()) stageDir.deleteRecursively()
        }
    }

    /** Last error message from a failed start attempt */
    @Volatile
    var lastError: String? = null
        private set

    /**
     * Ensure SillyTavern config.yaml exists with Android-compatible settings.
     * Most importantly: disable autorun (xdg-open doesn't exist on Android).
     */
    fun ensureConfig() {
        val configFile = File(stDir, "config.yaml")
        // Always overwrite with Android-safe config.
        // Default config has browserLaunch.enabled=true which crashes (no xdg-open).
        Log.i(TAG, "Writing Android config.yaml")
        configFile.writeText("""
            |# Auto-generated for Android — do not edit, will be overwritten on restart
            |dataRoot: ./data
            |listen: false
            |port: $SERVER_PORT
            |protocol:
            |  ipv4: true
            |  ipv6: false
            |dnsPreferIPv6: false
            |autorun: false
            |browserLaunch:
            |  enabled: false
            |  browser: ''
            |securityOverride: false
            |basicAuthMode: false
            |enableCorsProxy: false
            |whitelistMode: false
        """.trimMargin())
    }

    /**
     * Fix corrupted data directory entries from old broken zip extraction.
     * Some directory entries were saved as 0-byte files instead of dirs.
     */
    fun fixCorruptedDataDir() {
        val dataDir = stDataDir
        if (!dataDir.exists()) return

        // Known directories that SillyTavern expects
        val expectedDirs = listOf(
            "_uploads", "thumbnails", "thumbnails/bg", "thumbnails/avatar",
            "characters", "chats", "groups", "group chats", "worlds",
            "User Avatars", "backgrounds", "themes", "presets",
            "context", "instruct", "QuickReplies", "assets",
            "assets/ambient", "assets/bgm", "assets/blip",
            "assets/character", "assets/live2d", "assets/temp", "assets/vrm"
        )

        var fixed = 0
        for (dirName in expectedDirs) {
            val target = File(dataDir, dirName)
            if (target.exists() && !target.isDirectory) {
                Log.w(TAG, "Fixing corrupted entry: ${target.absolutePath} (file -> dir)")
                target.delete()
                target.mkdirs()
                fixed++
            } else if (!target.exists()) {
                target.mkdirs()
            }
        }
        if (fixed > 0) {
            Log.i(TAG, "Fixed $fixed corrupted data entries")
        }
    }

    /**
     * Quick test: run "node --version" to verify the binary works.
     * Returns version string on success, or error message on failure.
     */
    fun testNodeBinary(): String {
        val env = buildEnvironment()
        val pb = ProcessBuilder(nodeBinary.absolutePath, "--version")
            .directory(baseDir)
            .redirectErrorStream(true)
        pb.environment().putAll(env)

        return try {
            val proc = pb.start()
            val output = proc.inputStream.bufferedReader().readText().trim()
            val exitCode = proc.waitFor()
            if (exitCode == 0) {
                Log.i(TAG, "Node test OK: $output")
                output
            } else {
                Log.e(TAG, "Node test failed ($exitCode): $output")
                "EXIT $exitCode: $output"
            }
        } catch (e: Exception) {
            Log.e(TAG, "Node test exception", e)
            "ERROR: ${e.message}"
        }
    }

    /**
     * Start the Node.js server process.
     * Returns null on success, or error message on failure.
     */
    fun startServer(): String? {
        if (nodeProcess != null) {
            Log.w(TAG, "Server already running")
            return null
        }

        if (!isReady()) {
            val msg = "Not ready: node=${isNodeInstalled()}, st=${isSillyTavernInstalled()}"
            Log.e(TAG, msg)
            lastError = msg
            return msg
        }

        return try {
            val env = buildEnvironment()
            val cmd = arrayOf(
                nodeBinary.absolutePath,
                "server.js",
                "--port", SERVER_PORT.toString()
            )

            Log.i(TAG, "Starting: ${cmd.joinToString(" ")}")
            Log.i(TAG, "CWD: ${stDir.absolutePath}")
            Log.i(TAG, "ENV: $env")

            val pb = ProcessBuilder(*cmd)
                .directory(stDir)
                .redirectErrorStream(true)

            pb.environment().putAll(env)
            nodeProcess = pb.start()

            // Read initial output to check for immediate failure
            synchronized(processOutput) { processOutput.clear() }
            val reader = nodeProcess!!.inputStream.bufferedReader()

            // Start log reader thread
            Thread {
                try {
                    reader.forEachLine { line ->
                        synchronized(processOutput) {
                            if (processOutput.size < 500) processOutput.add(line)
                        }
                        Log.i("$TAG:Node", line)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Log reader stopped: ${e.message}")
                }
            }.apply {
                isDaemon = true
                name = "node-logger"
                start()
            }

            // Wait briefly and check if process died immediately
            Thread.sleep(3000)
            if (!isProcessAlive()) {
                val allLines = synchronized(processOutput) { processOutput.toList() }
                val tail = allLines.takeLast(30).joinToString("\n")
                val msg = "Node.js exited immediately.\n$tail"
                Log.e(TAG, msg)
                nodeProcess = null
                lastError = msg
                return msg
            }

            Log.i(TAG, "Node.js process started and alive")
            lastError = null
            null // success
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start Node.js", e)
            nodeProcess = null
            lastError = e.message
            "启动异常: ${e.message}"
        }
    }

    /** Stop the Node.js server process */
    fun stopServer() {
        nodeProcess?.let { proc ->
            try {
                proc.destroy()
                proc.waitFor()
                Log.i(TAG, "Node.js process stopped")
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping Node.js", e)
                try { proc.destroyForcibly() } catch (_: Exception) {}
            }
        }
        nodeProcess = null
    }

    /** Get captured process output for diagnostics */
    fun getProcessOutput(): String {
        return synchronized(processOutput) {
            processOutput.takeLast(20).joinToString("\n")
        }
    }

    /** Check if the process is still alive */
    fun isProcessAlive(): Boolean {
        return nodeProcess?.isAlive == true
    }

    /** Check if the HTTP server is responding */
    suspend fun isServerReachable(): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = URL(serverUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 2000
            conn.readTimeout = 2000
            conn.requestMethod = "GET"
            val code = conn.responseCode
            conn.disconnect()
            code in 200..399
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Extract Node.js shared libraries from assets.
     * These are Termux libraries that node depends on (libz, libssl, libicu, etc.)
     */
    suspend fun extractNodeLibs(onProgress: (String) -> Unit) = withContext(Dispatchers.IO) {
        onProgress("正在解压 Node.js 依赖库...")
        val libDir = nodeLibsDir
        if (libDir.exists()) libDir.deleteRecursively()
        libDir.mkdirs()

        try {
            // Copy to temp file first - AssetManager streaming can corrupt large zips
            val tmpZip = File(context.cacheDir, "nodelibs.zip")
            context.assets.open("nodelibs.zip").use { input ->
                FileOutputStream(tmpZip).use { output -> input.copyTo(output, 65536) }
            }
            FileInputStream(tmpZip).use { input ->
                extractZip(input, libDir, onProgress)
            }
            tmpZip.delete()
            Log.i(TAG, "Node libs extracted to: ${libDir.absolutePath}, files: ${libDir.list()?.size}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to extract node libs", e)
            throw e
        }
    }

    /**
     * Share Android's trusted certificate authorities with the bundled Node.js.
     * NODE_EXTRA_CA_CERTS extends Node's built-in roots, without disabling TLS
     * verification or trusting an arbitrary remote certificate.
     */
    private fun androidTrustBundle(): File? {
        return try {
            val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            factory.init(null as KeyStore?)
            val roots = factory.trustManagers
                .filterIsInstance<X509TrustManager>()
                .flatMap { it.acceptedIssuers.toList() }
                .distinctBy { Base64.encodeToString(it.encoded, Base64.NO_WRAP) }
            if (roots.isEmpty()) return null

            val bundle = File(baseDir, "android-trusted-cas.pem")
            val temp = File(baseDir, "android-trusted-cas.pem.tmp")
            val pem = buildString {
                for (cert in roots) {
                    append("-----BEGIN CERTIFICATE-----\n")
                    append(Base64.encodeToString(cert.encoded, Base64.NO_WRAP)
                        .chunked(64).joinToString("\n"))
                    append("\n-----END CERTIFICATE-----\n")
                }
            }
            temp.writeText(pem)
            if (!temp.renameTo(bundle)) {
                bundle.writeText(pem)
                temp.delete()
            }
            Log.i(TAG, "Added ${roots.size} Android-trusted CAs for Node.js TLS")
            bundle
        } catch (e: Exception) {
            Log.w(TAG, "Cannot export Android trust store; Node.js will use its built-in CAs", e)
            null
        }
    }

    /** Build environment variables for Node.js process. */
    private fun buildEnvironment(): Map<String, String> {
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val libsDir = nodeLibsDir.absolutePath
        val env = mutableMapOf(
            "HOME" to baseDir.absolutePath,
            "TMPDIR" to context.cacheDir.absolutePath,
            "NODE_ENV" to "production",
            "PATH" to "$nativeLibDir:/system/bin:/system/xbin",
            "LD_LIBRARY_PATH" to "$libsDir:$nativeLibDir"
        )
        androidTrustBundle()?.let { env["NODE_EXTRA_CA_CERTS"] = it.absolutePath }
        return env
    }

    /** Extract a ZIP stream to a target directory */
    private fun extractZip(input: InputStream, targetDir: File, onProgress: (String) -> Unit) {
        var count = 0
        ZipInputStream(BufferedInputStream(input)).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                // Normalize Windows backslashes to forward slashes for Linux/Android
                val entryName = entry.name.replace('\\', '/')
                val outFile = File(targetDir, entryName)

                // Security: prevent zip slip
                val canonicalRootPrefix = targetDir.canonicalPath + File.separator
                if (!outFile.canonicalPath.startsWith(canonicalRootPrefix)) {
                    Log.w(TAG, "Skipping zip entry outside target: ${entry.name}")
                    zis.closeEntry()
                    entry = zis.nextEntry
                    continue
                }

                // Detect directory: original check OR normalized name ends with /
                val isDir = entry.isDirectory || entryName.endsWith("/")

                if (isDir) {
                    outFile.mkdirs()
                } else {
                    // Ensure parent directories exist; remove conflicting files
                    outFile.parentFile?.let { parent ->
                        ensureDirectory(parent)
                    }
                    // If outFile itself is somehow a directory, skip
                    if (outFile.isDirectory) {
                        zis.closeEntry()
                        entry = zis.nextEntry
                        continue
                    }
                    FileOutputStream(outFile).use { fos ->
                        zis.copyTo(fos, 8192)
                    }
                }

                count++
                if (count % 200 == 0) {
                    onProgress("已解压 $count 个文件...")
                }

                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
        onProgress("解压完成，共 $count 个文件")
    }

    /** Ensure a path is a directory, removing any conflicting files along the path */
    private fun ensureDirectory(dir: File) {
        if (dir.exists()) {
            if (!dir.isDirectory) {
                dir.delete()
                dir.mkdirs()
            }
        } else {
            // mkdirs may fail if a parent is a file; walk up and fix
            if (!dir.mkdirs() && !dir.isDirectory) {
                // Find the blocking ancestor
                var ancestor: File? = dir
                while (ancestor != null && !ancestor.exists()) {
                    ancestor = ancestor.parentFile
                }
                if (ancestor != null && !ancestor.isDirectory) {
                    ancestor.delete()
                }
                dir.mkdirs()
            }
        }
    }

    /**
     * Import user data from Termux's SillyTavern installation.
     * Source: /data/data/com.termux/files/home/SillyTavern/data/
     * This only works if we have the files copied to shared storage first.
     */
    suspend fun importFromSharedStorage(sourceDir: File, onProgress: (String) -> Unit) =
        withContext(Dispatchers.IO) {
            if (!sourceDir.exists()) {
                throw FileNotFoundException("Source directory not found: ${sourceDir.absolutePath}")
            }

            onProgress("正在导入用户数据...")
            val destDir = stDataDir
            destDir.mkdirs()

            sourceDir.walkTopDown().forEach { file ->
                val relativePath = file.relativeTo(sourceDir).path
                val destFile = File(destDir, relativePath)

                if (file.isDirectory) {
                    destFile.mkdirs()
                } else {
                    destFile.parentFile?.mkdirs()
                    file.copyTo(destFile, overwrite = true)
                }
            }

            onProgress("数据导入完成")
        }
}
