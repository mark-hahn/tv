
import time
import libtorrent as lt
from tpblite import TPB

def download_magnet(magnet_link, save_path="./downloads"):
    ses = lt.session()
    ses.listen_on(6881, 6891)

    params = {
        'save_path': save_path,
        'storage_mode': lt.storage_mode_t.storage_mode_sparse,
    }

    handle = lt.add_magnet_uri(ses, magnet_link, params)

    print("Downloading metadata...")
    while not handle.has_metadata():
        time.sleep(1)

    print("Starting download:", handle.get_torrent_info().name())

    while handle.status().progress < 1:
        s = handle.status()
        print(f"{s.progress * 100:.2f}% complete")
        time.sleep(2)

    print("Download complete.")

def search_and_download(query):
    tpb = TPB()
    results = tpb.search(query)

    if not results:
        print("No results found.")
        return

    torrent = results[0]
    print("Selected:", torrent.name)

    download_magnet(torrent.magnetlink)

if __name__ == "__main__":
    search_and_download("Example TV Show S01E01")
