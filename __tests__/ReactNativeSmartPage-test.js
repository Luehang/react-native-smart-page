import "react-native";
import React from "react";
import { View } from "react-native";
import SmartPage from "../src";

// Note: test renderer must be required after react-native.
import renderer from "react-test-renderer";

it("React Native Smart Page renders correctly", () => {
    renderer.create(<SmartPage><View/></SmartPage>);
});
