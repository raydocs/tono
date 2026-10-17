package com.raydocs.tono.mobile.ipc;

import com.raydocs.tono.mobile.ipc.ITonoEngineListener;

interface ITonoEngine {
    void register(ITonoEngineListener listener);
    void unregister(ITonoEngineListener listener);
    /** One JSON command, e.g. {"op":"connect"}; see engine/EngineCommand.kt. */
    void command(String commandJson);
    /** Route explanation for the in-app check; returns JSON. */
    String explain(String host);
}
