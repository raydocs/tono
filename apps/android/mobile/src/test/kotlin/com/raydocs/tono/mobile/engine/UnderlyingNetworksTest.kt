package com.raydocs.tono.mobile.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class UnderlyingNetworksTest {
    @Test fun aMissingNetworkIsAnEmptyListNotASystemDefault() {
        assertEquals(emptyList<String>(), underlyingNetworkArgument(null))
    }

    @Test fun aLiveNetworkIsThatNetworkAlone() {
        assertEquals(listOf("wifi"), underlyingNetworkArgument("wifi"))
    }
}
