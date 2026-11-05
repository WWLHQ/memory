"""
Memory Library MCP Server
==========================

把你的向量数据库（默认 Chroma，可换 PGVector / FAISS）暴露成一组 MCP 工具，
让任意支持 MCP 的客户端（WorkBuddy、Claude Desktop、Cursor 等）通过 HTTP
共享同一份记忆库，并支持 检索 / 读取 / 写入 / 管理 全套能力。

推荐技术栈（已在代码中默认实现，可按需替换）：
  - 后端向量库 : Chroma（本地持久化，零外部依赖即可跑）
  - 嵌入模型   : Chroma 内置 sentence-transformers (all-MiniLM-L6-v2，首次运行自动下载)
  - 传输方式   : streamable-http（远程多客户端共享）；也支持 stdio（本机单客户端）

运行（远程共享模式，推荐）:
  pip install -r requirements.txt
  python memory_server.py                      # 默认 http://0.0.0.0:8000/mcp
  python memory_server.py --transport stdio    # 本机 stdio 模式（由客户端拉起）

环境变量:
  MEMORY_DIR        持久化目录，默认 ./memory_data
  MEMORY_COLLECTION 默认集合名，默认 "default"
  MEMORY_HOST/PORT  仅 HTTP 模式，默认 0.0.0.0:8000
"""

import os
import sys
import json
import uuid
import argparse


# --------------------------------------------------------------------------- #
# 向量库接入层（想换 PGVector / FAISS，只改这一块）
# --------------------------------------------------------------------------- #
def _chroma_client():
    import chromadb
    persist_dir = os.getenv("MEMORY_DIR", "./memory_data")
    return chromadb.PersistentClient(path=persist_dir)


def _collection(name=None):
    default = os.getenv("MEMORY_COLLECTION", "default")
    return _chroma_client().get_or_create_collection(name or default)


# --------------------------------------------------------------------------- #
# MCP Server
# --------------------------------------------------------------------------- #
from mcp.server.fastmcp import FastMCP

HOST = os.getenv("MEMORY_HOST", "0.0.0.0")
PORT = int(os.getenv("MEMORY_PORT", "8000"))

mcp = FastMCP("memory-library", host=HOST, port=PORT)


@mcp.tool()
def search_memory(query: str, top_k: int = 5, collection: str = None) -> str:
    """语义检索记忆库，返回按相关度排序的文本片段。"""
    col = _collection(collection)
    res = col.query(query_texts=[query], n_results=max(1, min(top_k, 50)))
    docs, metas, ids = res["documents"][0], res["metadatas"][0], res["ids"][0]
    if not docs:
        return "未找到相关记忆。"
    return "\n\n".join(
        f"[{i}] id={_id}\n{text}\n(meta: {meta})"
        for i, (text, meta, _id) in enumerate(zip(docs, metas, ids), 1)
    )


@mcp.tool()
def get_memory(id: str, collection: str = None) -> str:
    """按 id 获取单条记忆。"""
    col = _collection(collection)
    res = col.get(ids=[id])
    if not res["documents"]:
        return f"未找到 id={id} 的记忆。"
    return f"id={id}\n{res['documents'][0]}\n(meta: {res['metadatas'][0]})"


@mcp.tool()
def add_memory(content: str, metadata: str = "{}", collection: str = None) -> str:
    """写入一条新记忆。metadata 为 JSON 字符串，例如 '{\"topic\":\"ai\"}'。"""
    col = _collection(collection)
    _id = str(uuid.uuid4())
    meta = json.loads(metadata) if metadata else {}
    col.add(ids=[_id], documents=[content], metadatas=[meta])
    return f"已写入记忆 id={_id}"


@mcp.tool()
def update_memory(id: str, content: str = None,
                 metadata: str = None, collection: str = None) -> str:
    """更新已有记忆的内容 / 元数据。"""
    col = _collection(collection)
    kwargs = {"ids": [id]}
    if content is not None:
        kwargs["documents"] = [content]
    if metadata is not None:
        kwargs["metadatas"] = [json.loads(metadata)]
    col.update(**kwargs)
    return f"已更新记忆 id={id}"


@mcp.tool()
def delete_memory(id: str, collection: str = None) -> str:
    """按 id 删除一条记忆。"""
    _collection(collection).delete(ids=[id])
    return f"已删除记忆 id={id}"


@mcp.tool()
def list_collections() -> str:
    """列出记忆库中所有集合。"""
    names = [c.name for c in _chroma_client().list_collections()]
    return "、".join(names) if names else "(暂无集合)"


@mcp.tool()
def create_collection(name: str) -> str:
    """新建一个空集合。"""
    _chroma_client().create_collection(name)
    return f"已创建集合 '{name}'"


@mcp.tool()
def delete_collection(name: str) -> str:
    """删除集合及其全部记忆。"""
    _chroma_client().delete_collection(name)
    return f"已删除集合 '{name}'"


def main():
    parser = argparse.ArgumentParser(description="Memory Library MCP Server")
    parser.add_argument("--transport", choices=["streamable-http", "stdio"],
                        default="streamable-http")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    if args.transport == "streamable-http":
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        print(f"[memory-mcp] serving on http://{args.host}:{args.port}/mcp",
              file=sys.stderr)
    mcp.run(transport=args.transport)


if __name__ == "__main__":
    main()
