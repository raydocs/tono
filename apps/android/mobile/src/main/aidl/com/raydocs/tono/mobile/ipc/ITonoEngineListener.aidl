package com.raydocs.tono.mobile.ipc;

oneway interface ITonoEngineListener {
    /** Full engine snapshot as JSON (see engine/EngineSnapshot.kt). Never contains secrets. */
    void onSnapshot(String snapshotJson);
}
