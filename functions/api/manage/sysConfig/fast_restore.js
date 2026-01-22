import { getDatabase } from '../../../utils/databaseAdapter.js';

export async function onRequest(context) {
    const { request, env } = context;

    // 只允许 POST 请求
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const db = getDatabase(env);

        const contentType = request.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            return new Response(JSON.stringify({ error: 'Please upload JSON backup file' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const backupData = await request.json();

        // 验证备份文件格式
        if (!backupData.data || !backupData.data.files || !backupData.data.settings) {
            return new Response(JSON.stringify({ error: 'Invalid backup file format' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let restoredFiles = 0;
        let restoredSettings = 0;
        const BATCH_SIZE = 20; // 批处理大小，并发 20

        // ==================== 批量恢复文件数据 ====================
        const fileEntries = Object.entries(backupData.data.files);
        // 使用 for 循环进行分批
        for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
            const batch = fileEntries.slice(i, i + BATCH_SIZE);

            // Promise.all 并行执行当前批次
            await Promise.all(batch.map(async ([key, fileData]) => {
                try {
                    if (fileData.value) {
                        // 对于有value的文件（如telegram分块文件），恢复完整数据
                        await db.put(key, fileData.value, {
                            metadata: fileData.metadata
                        });
                    } else if (fileData.metadata) {
                        // 只恢复元数据，value 为空字符串
                        await db.put(key, '', {
                            metadata: fileData.metadata
                        });
                    }
                    restoredFiles++;
                } catch (error) {
                    console.error(`Failed to restore file ${key}:`, error);
                }
            }));
        }

        // ==================== 批量恢复系统设置 ====================
        const settingEntries = Object.entries(backupData.data.settings);
        for (let i = 0; i < settingEntries.length; i += BATCH_SIZE) {
            const batch = settingEntries.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async ([key, value]) => {
                try {
                    await db.put(key, value);
                    restoredSettings++;
                } catch (error) {
                    console.error(`Failed to restore setting ${key}:`, error);
                }
            }));
        }

        return new Response(JSON.stringify({
            success: true,
            message: 'Fast Restore Complete',
            stats: {
                restoredFiles,
                restoredSettings,
                backupTimestamp: backupData.timestamp
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: 'Restore failed: ' + error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
