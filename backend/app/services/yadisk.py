import os
import httpx
from typing import Optional


def _get_token():
    from app.config import settings
    return getattr(settings, 'YANDEX_DISK_TOKEN', '')


async def upload_file(file_path: str, filename: str) -> Optional[str]:
    token = _get_token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(
                'https://cloud-api.yandex.net/v1/disk/resources/upload',
                headers={'Authorization': f'OAuth {token}'},
                params={'path': f'/GOST/{filename}', 'overwrite': 'true'}
            )
            resp.raise_for_status()
            upload_url = resp.json()['href']
            with open(file_path, 'rb') as f:
                await client.put(upload_url, content=f.read())
            link = f'https://disk.yandex.ru/client/disk/GOST/{filename}'
            print(f'[YaDisk] Загружен: {filename}')
            return link
    except Exception as e:
        print(f'[YaDisk] Ошибка: {e}')
        return None


async def upload_document(docx_path: str, pdf_path: Optional[str], doc_title: str) -> dict:
    links = {}
    if docx_path and os.path.exists(docx_path):
        link = await upload_file(docx_path, f'{doc_title}.docx')
        if link:
            links['docx'] = link
    if pdf_path and os.path.exists(pdf_path):
        link = await upload_file(pdf_path, f'{doc_title}.pdf')
        if link:
            links['pdf'] = link
    return links


def is_configured() -> bool:
    return bool(_get_token())
